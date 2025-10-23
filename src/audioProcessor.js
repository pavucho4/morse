// Handles microphone capture, band-pass/high-pass filtering, energy detection and simple morse timing

export class AudioMorseReceiver {
  constructor({onSymbol, onRawToggle, highpassHz = 1200, fftSize=2048, sampleRate=44100}){
    this.onSymbol = onSymbol // called when a decoded letter arrives
    this.onRawToggle = onRawToggle // called for debug: (isToneOn, level)
    this.highpassHz = highpassHz
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
    this.symbolBuffer = ''
    this.charBuffer = ''

    // timing thresholds (ms) - will be set from wpm
    this.dotMs = 120 // default, will be overridden by setWPM
    this.dashMs = 360
    this.intraCharGap = 120
    this.interCharGap = 360
    this.interWordGap = 840

    this.fftBuffer = new Uint8Array(this.fftSize/2)
  }

  setWPM(groupsPerMin){
    // groupsPerMin = 6..9 (user). 1 group =5 chars, so charsPerMin = groupsPerMin*5
    const charsPerMin = groupsPerMin * 5
    // rough mapping: dot length (ms) = 1200 / WPM_chars (approximation)
    // use: dot = 60000 / (50 * WPM_chars) * some constant. We'll use simple linear mapping:
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

    // highpass filter to remove low freq noise
    this.filter = this.audioCtx.createBiquadFilter()
    this.filter.type = 'highpass'
    this.filter.frequency.value = this.highpassHz

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
      try{ this.audioCtx.close() }catch(e){}
    }
  }

  loop(){
    if(!this.running) return
    this.analyser.getByteFrequencyData(this.fftBuffer)
    // detect energy in a target high-frequency band (e.g. bins corresponding to 1.2kHz..4kHz)
    const sampleRate = this.audioCtx.sampleRate
    const binCount = this.fftBuffer.length
    const nyquist = sampleRate/2
    const freqPerBin = nyquist / binCount
    const lowHz = 1200
    const highHz = 4000
    const lowBin = Math.floor(lowHz / freqPerBin)
    const highBin = Math.min(binCount-1, Math.floor(highHz / freqPerBin))

    let sum = 0
    for(let i=lowBin;i<=highBin;i++) sum += this.fftBuffer[i]
    const avg = sum / (highBin-lowBin+1)

    // simple adaptive threshold
    const threshold = 40
    const isToneNow = avg > threshold

    const now = performance.now()

    if(isToneNow && !this.isTone){
      // tone started
      this.isTone = true
      this.toneStart = now
    } else if(!isToneNow && this.isTone){
      // tone ended
      this.isTone = false
      this.toneEnd = now
      const dur = this.toneEnd - this.toneStart
      // dot or dash
      if(dur < (this.dotMs + this.dashMs)/2){
        this.symbolBuffer += '.'
      } else {
        this.symbolBuffer += '-'
      }
      // notify raw toggle
      this.onRawToggle && this.onRawToggle(false, avg)
      this.lastTick = now
    }

    // if gap long enough -> symbol ended -> decode char
    const gap = now - this.lastTick
    if(!this.isTone && this.symbolBuffer && gap > this.interCharGap){
      // decode symbolBuffer to char
      this.onSymbol && this.onSymbol(this.symbolBuffer)
      this.symbolBuffer = ''
      this.lastTick = now
    }

    // telemetry callback
    this.onRawToggle && this.onRawToggle(this.isTone, avg)

    requestAnimationFrame(this.loop.bind(this))
  }
}