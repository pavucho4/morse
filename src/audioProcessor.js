import { decodeGap } from './morseDecoder';

export class AudioMorseReceiver {
    constructor(options) {
        this.options = {
            onSymbol: () => {},
            onRawToggle: () => {},
            centerFreqHz: 1600,
            bandwidthHz: 100,
            fftSize: 2048,
            sampleRate: 44100,
            dashDotRatio: 4.5,
            pauseMultiplier: 5.5,
            staticThreshold: 15, // Статический порог (0-255)
            minToneDurationMs: 20, // Шумодав
            ...options
        };

        this.wpm = 60;
        this.dotMs = 60000 / (50 * this.wpm); // Длительность точки
        this.dashMs = this.dotMs * this.options.dashDotRatio; // Длительность тире

        this.audioContext = null;
        this.analyser = null;
        this.mediaStreamSource = null;
        this.bandpassFilter = null;

        this.isTone = false;
        this.toneStart = 0;
        this.lastToneEnd = 0;
        this.sequence = '';
        this.animationFrameId = null;
    }

    setWPM(wpm) {
        this.wpm = wpm;
        this.dotMs = 60000 / (50 * this.wpm);
        this.dashMs = this.dotMs * this.options.dashDotRatio;
    }

    async start() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Ваш браузер не поддерживает MediaDevices API. Невозможно получить доступ к микрофону.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.options.fftSize;

            this.bandpassFilter = this.audioContext.createBiquadFilter();
            this.bandpassFilter.type = 'bandpass';
            this.bandpassFilter.frequency.setValueAtTime(this.options.centerFreqHz, this.audioContext.currentTime);
            this.bandpassFilter.Q.setValueAtTime(this.options.centerFreqHz / this.options.bandwidthHz, this.audioContext.currentTime);

            this.mediaStreamSource.connect(this.bandpassFilter);
            this.bandpassFilter.connect(this.analyser);

            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.processAudio();
        } catch (err) {
            console.error('Ошибка доступа к микрофону:', err);
            alert(`Не удалось получить доступ к микрофону: ${err.name}`);
        }
    }

    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        if (this.mediaStreamSource && this.mediaStreamSource.mediaStream) {
            this.mediaStreamSource.mediaStream.getTracks().forEach(track => track.stop());
        }
        this.isTone = false;
        this.options.onRawToggle(false);
        this.sequence = '';
        this.lastToneEnd = 0;
    }

    processAudio = () => {
        this.animationFrameId = requestAnimationFrame(this.processAudio);

        this.analyser.getByteFrequencyData(this.dataArray);
        
        // 1. Обнаружение сигнала в узкой полосе
        const centerFreqHz = this.options.centerFreqHz;
        const bandwidthHz = this.options.bandwidthHz;
        const sampleRate = this.audioContext.sampleRate;
        const binCount = this.dataArray.length;
        const nyquist = sampleRate / 2;
        const freqPerBin = nyquist / binCount;
        const centerBin = Math.floor(centerFreqHz / freqPerBin);
        const binRange = Math.ceil((bandwidthHz / 2) / freqPerBin);
        const lowBin = Math.max(0, centerBin - binRange);
        const highBin = Math.min(binCount - 1, centerBin + binRange);

        let sum = 0;
        for (let i = lowBin; i <= highBin; i++) {
            sum += this.dataArray[i];
        }
        const avg = sum / (highBin - lowBin + 1);
        
        const currentTime = Date.now();
        
        // 2. Статический порог обнаружения (detectionThreshold = staticThreshold)
        const detectionThreshold = this.options.staticThreshold;
        const isToneNow = avg > detectionThreshold;

        // 3. Обработка переходов
        if (isToneNow && !this.isTone) {
            // Начало тона
            
            // Обработка паузы перед новым тоном
            if (this.lastToneEnd > 0) {
                const gapDuration = currentTime - this.lastToneEnd;
                // Используем 7 * dotMs для межсловной паузы
                const interWordGap = this.dotMs * 7; 
                const gapType = decodeGap(gapDuration, this.dotMs, interWordGap, this.options.pauseMultiplier);
                if (gapType) {
                    this.options.onSymbol('', gapType); // Отправляем пробел
                }
            }
            
            this.toneStart = currentTime;
            this.isTone = true;
            // Передаем статический порог и текущий avg для осциллограммы
            this.options.onRawToggle(true, avg, detectionThreshold); 
            
        } else if (!isToneNow && this.isTone) {
            // Конец тона
            const toneDuration = currentTime - this.toneStart;
            
            // Шумодав: игнорируем тон, если он слишком короткий
            if (toneDuration >= this.options.minToneDurationMs) {
                // Декодирование символа
                let symbol = '';
                // Используем настраиваемое соотношение для определения порога
                const dotDashThreshold = (this.dotMs * this.options.dashDotRatio + this.dashMs) / (this.options.dashDotRatio + 1);
                
                if (toneDuration < dotDashThreshold) {
                    symbol = '.';
                } else {
                    symbol = '-';
                }
                
                this.sequence += symbol;
                this.options.onSymbol(this.sequence, ''); // Отправляем символ
                this.sequence = ''; // Сбрасываем для следующего символа
            }
            
            this.lastToneEnd = currentTime;
            this.isTone = false;
            this.options.onRawToggle(false, avg, detectionThreshold);
        } else if (isToneNow && this.isTone) {
            // Тон продолжается
            this.options.onRawToggle(true, avg, detectionThreshold);
        } else {
            // Пауза продолжается
            this.options.onRawToggle(false, avg, detectionThreshold);
        }
        
        // 4. Обработка межсимвольной паузы (таймаут)
        if (!this.isTone && this.lastToneEnd > 0) {
            const gapDuration = currentTime - this.lastToneEnd;
            const interWordGap = this.dotMs * 7; 
            const gapType = decodeGap(gapDuration, this.dotMs, interWordGap, this.options.pauseMultiplier);
            
            // Если пауза достаточно длинная, чтобы быть межсловной, сбрасываем lastToneEnd, чтобы не отправлять больше пробелов
            if (gapType === '  ') {
                this.options.onSymbol('', gapType); // Отправляем межсловный пробел
                this.lastToneEnd = 0; 
            }
        }
    }
}
