// Handles microphone capture, band-pass/high-pass filtering, energy detection and simple morse timing
import { decodeGap } from './morseDecoder'

export class AudioMorseReceiver {
  constructor({onSymbol, onRawToggle, centerFreqHz = 1600, bandwidthHz = 400, fftSize=2048, sampleRate=44100, dashDotRatio = 3.0, pauseMultiplier = 3.0}){
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
    this.alpha = 0.95 

    // timing thresholds (ms) - will be set from wpm
    this.dotMs = 120 
    this.dashMs = 360
    this.intraCharGap = 120
    this.interCharGap = 360
    this.interWordGap = 840
    
    // Новые настраиваемые параметры
    this.dashDotRatio = dashDotRatio // Соотношение Тире/Точка (по умолчанию 3.0)
    this.pauseMultiplier = pauseMultiplier // Множитель для межсимвольной паузы (по умолчанию 3.0)

    this.fftBuffer = new Uint8Array(this.fftSize/2)
  }

  setWPM(wpm){
    // Стандартная формула для расчета длительности точки (ms) на основе WPM
    // WPM = 1200 / T_dot (где T_dot - длительность точки в мс для слова PARIS)
    // T_dot = 1200 / WPM
    
    // Для нашего случая, где WPM - это Groups Per Minute (GPM), и 1 группа = 5 символов
    // T_dot = 60000 / (50 * WPM)
    // Мы используем более простую формулу, где WPM - это слова в минуту (PARIS), 
    // и 1 WPM = 60/50 = 1.2 dot/sec. 
    // T_dot = 1200 / WPM (для 50 WPM, T_dot = 24ms, что слишком мало)
    
    // Используем формулу для T_dot = 60000 / (50 * WPM) = 1200 / WPM
    // T_dot = 60000 / (50 * WPM) = 1200 / WPM - это для WPM, где 1 WPM = 1 слово в минуту.
    // Для 60 WPM T_dot = 20ms, что очень быстро.
    
    // Используем более реалистичный подход, где WPM - это количество слов PARIS в минуту.
    // Длительность точки (T_dot) = 1200 / WPM (для 25 WPM T_dot = 48ms)
    // Давайте использовать формулу, которая дает более разумные значения для любительской связи:
    // T_dot = 60000 / (12 * WPM) - для 12 WPM, T_dot = 416ms
    // T_dot = 1200 / WPM - для 60 WPM, T_dot = 20ms
    
    // Вернемся к простому: WPM - это символы в минуту. 
    // T_dot = 60000 / (12 * WPM_символов)
    // Для 60 WPM (слов в минуту) это около 300 символов в минуту.
    // T_dot = 60000 / (12 * 300) = 16.6ms - все еще слишком быстро.
    
    // Примем, что WPM - это слова в минуту (PARIS).
    // T_dot = 1200 / WPM (для 25 WPM T_dot = 48ms)
    // T_dot = 60000 / (50 * WPM) - для 25 WPM T_dot = 48ms
    
    // Используем T_dot = 1200 / WPM, но сдвинем диапазон WPM
    const dot = Math.max(20, Math.round(1200 / wpm)) // 60 WPM -> 20ms, 30 WPM -> 40ms, 150 WPM -> 8ms
    
    this.dotMs = dot
    this.dashMs = Math.round(this.dotMs * this.dashDotRatio) // Используем настраиваемый коэффициент
    this.intraCharGap = this.dotMs
    this.interCharGap = Math.round(this.dotMs * this.pauseMultiplier) // Используем настраиваемый множитель
    this.interWordGap = this.dotMs * 7 // Стандартное 7 * T_dot
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
    this.filter.Q.value = this.centerFreqHz / this.bandwidthHz 

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
      this.peakLevel = avg
    } else if(isToneNow && this.isTone) {
      this.peakLevel = Math.max(this.peakLevel, avg)
    } else if(!isToneNow && this.isTone){
      // tone ended
      this.isTone = false
      this.toneEnd = now
      this.lastToneEnd = now 
      const dur = this.toneEnd - this.toneStart
      
      // dot or dash
      // Используем среднее арифметическое между dotMs и dashMs для определения порога
      const dotDashThreshold = (this.dotMs + this.dashMs) / 2
      
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
      // Используем interCharGap для определения межсимвольной паузы
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
