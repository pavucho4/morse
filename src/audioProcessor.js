// Handles microphone capture, band-pass/high-pass filtering, energy detection and simple morse timing
import { decodeGap } from './morseDecoder'

export class AudioMorseReceiver {
  constructor({onSymbol, onRawToggle, centerFreqHz = 1600, bandwidthHz = 100, fftSize=2048, sampleRate=44100, dashDotRatio = 3.0, pauseMultiplier = 3.0}){
    this.onSymbol = onSymbol // called when a decoded letter arrives (seq, gapType)
    this.onRawToggle = onRawToggle // called for debug: (isToneOn, level)
    this.centerFreqHz = centerFreqHz 
    this.bandwidthHz = bandwidthHz   
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
    this.alpha = 0.99 // Увеличиваем сглаживание для более стабильного шумового порога
    this.noiseThresholdMultiplier = 2.0 // Уровень сигнала должен быть в 2 раза выше шума
    this.minToneDurationMs = 20 // Минимальная длительность тона, чтобы отфильтровать короткие всплески шума

    // timing thresholds (ms) - will be set from wpm
    this.dotMs = 120 
    this.dashMs = 360
    this.intraCharGap = 120
    this.interCharGap = 360
    this.interWordGap = 840
    
    // Настраиваемые параметры
    this.dashDotRatio = dashDotRatio 
    this.pauseMultiplier = pauseMultiplier 

    this.fftBuffer = new Uint8Array(this.fftSize/2)
  }

  setWPM(wpm){
    // T_dot = 1200 / WPM (для 25 WPM T_dot = 48ms)
    const dot = Math.max(20, Math.round(1200 / wpm)) 
    
    this.dotMs = dot
    this.dashMs = Math.round(this.dotMs * this.dashDotRatio) 
    this.intraCharGap = this.dotMs
    // Межсимвольная пауза: T_dot * PauseMultiplier (в APAK 2.12 это x5.5)
    this.interCharGap = Math.round(this.dotMs * this.pauseMultiplier) 
    // Межсловная пауза: Стандартное 7 * T_dot
    this.interWordGap = this.dotMs * 7 
  }

  async start(){
    if(this.running) return
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.source = this.audioCtx.createMediaStreamSource(stream)

    // Bandpass filter для тонкой настройки. Уменьшаем bandwidth для избирательности.
    this.filter = this.audioCtx.createBiquadFilter()
    this.filter.type = 'bandpass'
    this.filter.frequency.value = this.centerFreqHz
    // Увеличиваем Q-factor (добротность) для более узкой полосы пропускания
    this.filter.Q.value = this.centerFreqHz / this.bandwidthHz 

    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = this.fftSize

    this.source.connect(this.filter)
    this.filter.connect(this.analyser)

    this.running = true
    this.loop()
  }

  stop(){
    this.running = false
    if(this.audioCtx){
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
    
    const now = performance.now()

    // 1. Адаптивный шумовой порог: обновляем только когда нет тона
    if (!this.isTone) {
      this.noiseFloor = this.noiseFloor * this.alpha + avg * (1 - this.alpha)
    }
    
    // 2. Порог обнаружения сигнала: должен быть значительно выше шумового порога
    const detectionThreshold = this.noiseFloor * this.noiseThresholdMultiplier
    const isToneNow = avg > detectionThreshold

    if(isToneNow && !this.isTone){
      // tone started
      this.isTone = true
      this.toneStart = now
      this.peakLevel = avg
    } else if(isToneNow && this.isTone) {
      this.peakLevel = Math.max(this.peakLevel, avg)
    } else if(!isToneNow && this.isTone){
      // tone ended
      this.isTone = false
      this.toneEnd = now
      this.lastToneEnd = now 
      const dur = this.toneEnd - this.toneStart
      
      // 3. Проверка минимальной длительности тона (для отсева шума)
      if (dur < this.minToneDurationMs) {
        // Игнорируем слишком короткий тон (шум)
        this.onRawToggle && this.onRawToggle(false, avg)
        this.lastTick = now
        requestAnimationFrame(this.loop.bind(this))
        return
      }

      // dot or dash
      // Используем настраиваемое соотношение для определения порога
      const dotDashThreshold = (this.dotMs * this.dashDotRatio + this.dashMs) / (this.dashDotRatio + 1)
      
      if(dur < dotDashThreshold){ 
        this.symbolBuffer += '.'
      } else {
        this.symbolBuffer += '-'
      }
      
      this.onRawToggle && this.onRawToggle(false, avg)
      this.lastTick = now
    }

    // if gap long enough -> symbol ended -> decode char
    const gap = now - this.lastToneEnd 
    if(!this.isTone && this.symbolBuffer && gap > this.dotMs){ 
      // decode symbolBuffer to char
      const gapType = decodeGap(gap, this.dotMs, this.interCharGap, this.interWordGap)
      this.onSymbol && this.onSymbol(this.symbolBuffer, gapType)
      this.symbolBuffer = ''
      this.lastTick = now
    }

    // telemetry callback
    this.onRawToggle && this.onRawToggle(this.isTone, avg)

    requestAnimationFrame(this.loop.bind(this))
  }
}
