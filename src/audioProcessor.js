// Handles microphone capture, band-pass/high-pass filtering, energy detection and simple morse timing
import { decodeGap } from './morseDecoder'

export class AudioMorseReceiver {
  constructor({onSymbol, onRawToggle, centerFreqHz = 1600, bandwidthHz = 400, fftSize=2048, sampleRate=44100}){
    this.onSymbol = onSymbol // called when a decoded letter arrives (seq, gapType)
    this.onRawToggle = onRawToggle // called for debug: (isToneOn, level)
    this.centerFreqHz = centerFreqHz // Центральная частота для Bandpass
    this.bandwidthHz = bandwidthHz   // Ширина полосы для Bandpass
    this.fftSize = fftSize
    this.sampleRate = sampleRate

    this.audioCtx = null
    this.analyser = null
    this.source = null
    this.filter = null
    this.running = false

    // morse timing state
    this.isTone = false
    this.toneStart = 0
    this.toneEnd = 0
    this.lastTick = performance.now()
    this.lastToneEnd = 0 
    this.symbolBuffer = ''
    this.charBuffer = ''

    // adaptive threshold
    this.noiseFloor = 0
    this.peakLevel = 0
    this.alpha = 0.95 // Коэффициент сглаживания для шумового порога

    // timing thresholds (ms) - will be set from wpm
    this.dotMs = 120 
    this.dashMs = 360
    this.intraCharGap = 120
    this.interCharGap = 360
    this.interWordGap = 840

    this.fftBuffer = new Uint8Array(this.fftSize/2)
  }

  setWPM(groupsPerMin){
    const charsPerMin = groupsPerMin * 5
    const dot = Math.max(40, Math.round(1200 / (charsPerMin/30)))
    this.dotMs = dot
    this.dashMs = Math.round(this.dotMs * 3)
    this.intraCharGap = this.dotMs
    this.interCharGap = this.dotMs * 3
    this.interWordGap = this.dotMs * 7
  }

  async start(){
    if(this.running) return
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.source = this.audioCtx.createMediaStreamSource(stream)

    // Bandpass filter для тонкой настройки
    this.filter = this.audioCtx.createBiquadFilter()
    this.filter.type = 'bandpass'
    this.filter.frequency.value = this.centerFreqHz
    this.filter.Q.value = this.centerFreqHz / this.bandwidthHz // Q-factor

    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = this.fftSize

    this.source.connect(this.filter)
    this.filter.connect(this.analyser)
    // НЕ ПОДКЛЮЧАЕМ К DESTINATION, чтобы избежать эха

    this.running = true
    this.loop()
  }

  stop(){
    this.running = false
    if(this.audioCtx){
      // Останавливаем все треки в потоке
      this.source.mediaStream.getTracks().forEach(track => track.stop())
      try{ this.audioCtx.close() }catch(e){}
    }
  }

  loop(){
    if(!this.running) return
    this.analyser.getByteFrequencyData(this.fftBuffer)
    
    const sampleRate = this.audioCtx.sampleRate
    const binCount = this.fftBuffer.length
    const nyquist = sampleRate/2
    const freqPerBin = nyquist / binCount
    
    // Определяем бины, соответствующие центральной частоте
    const centerBin = Math.floor(this.centerFreqHz / freqPerBin)
    const binRange = Math.ceil((this.bandwidthHz / 2) / freqPerBin)
    const lowBin = Math.max(0, centerBin - binRange)
    const highBin = Math.min(binCount-1, centerBin + binRange)

    let sum = 0
    for(let i=lowBin;i<=highBin;i++) sum += this.fftBuffer[i]
    const avg = sum / (highBin-lowBin+1)
    
    // Адаптивный порог:
    // 1. Обновляем шумовой порог (noiseFloor)
    if (!this.isTone) {
      this.noiseFloor = this.noiseFloor * this.alpha + avg * (1 - this.alpha)
    }
    
    // 2. Определяем порог как noiseFloor + смещение (например, 10-20 единиц)
    const thresholdOffset = 15 
    const threshold = this.noiseFloor + thresholdOffset
    
    const isToneNow = avg > threshold

    const now = performance.now()

    if(isToneNow && !this.isTone){
      // tone started
      this.isTone = true
      this.toneStart = now
      // Обновляем peakLevel при начале тона
      this.peakLevel = avg
    } else if(isToneNow && this.isTone) {
      // Обновляем peakLevel во время тона
      this.peakLevel = Math.max(this.peakLevel, avg)
    } else if(!isToneNow && this.isTone){
      // tone ended
      this.isTone = false
      this.toneEnd = now
      this.lastToneEnd = now 
      const dur = this.toneEnd - this.toneStart
      
      // dot or dash
      // Используем более точный порог: 2 * dotMs
      if(dur < this.dotMs * 2){ 
        this.symbolBuffer += '.'
      } else {
        this.symbolBuffer += '-'
      }
      
      // notify raw toggle
      this.onRawToggle && this.onRawToggle(false, avg)
      this.lastTick = now
    }

    // if gap long enough -> symbol ended -> decode char
    const gap = now - this.lastToneEnd 
    if(!this.isTone && this.symbolBuffer && gap > this.dotMs){ 
      // decode symbolBuffer to char
      const gapType = decodeGap(gap, this.dotMs)
      this.onSymbol && this.onSymbol(this.symbolBuffer, gapType)
      this.symbolBuffer = ''
      this.lastTick = now
    }

    // telemetry callback
    this.onRawToggle && this.onRawToggle(this.isTone, avg)

    requestAnimationFrame(this.loop.bind(this))
  }
}
