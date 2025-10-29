import React, { useRef, useEffect, useState } from 'react';

// Принимаем новые параметры: noiseFloor и detectionThreshold
const FrequencyVisualizer = ({ analyser, isTone, noiseFloor, detectionThreshold }) => {
  const canvasRef = useRef(null);
  const oscCanvasRef = useRef(null); // Новый Canvas для осциллограммы
  const [dataArray, setDataArray] = useState(null);
  const [bufferLength, setBufferLength] = useState(0);
  const [oscBuffer, setOscBuffer] = useState([]); // Буфер для осциллограммы

  useEffect(() => {
    if (analyser) {
      const bLength = analyser.frequencyBinCount;
      setBufferLength(bLength);
      setDataArray(new Uint8Array(bLength));
    }
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const oscCanvas = oscCanvasRef.current;
    if (!canvas || !oscCanvas || !analyser || !dataArray) return;

    const canvasCtx = canvas.getContext('2d');
    const oscCtx = oscCanvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const OSC_HEIGHT = oscCanvas.height;

    let animationFrameId;
    
    // Новая функция для масштабирования, которая растягивает диапазон 0-50 на большую часть графика
    const MAX_VISUAL_VALUE = 50; // Максимальное значение, которое мы хотим видеть на графике
    const valueToY = (value) => {
        const clampedValue = Math.min(value, MAX_VISUAL_VALUE);
        // Масштабируем clampedValue (0-50) на высоту графика (0-HEIGHT)
        return HEIGHT - (clampedValue / MAX_VISUAL_VALUE) * HEIGHT;
    };
    
    // Функция для отрисовки осциллограммы
    const drawOscilloscope = (avg) => {
        // Обновляем буфер: добавляем текущее среднее значение и удаляем старое
        setOscBuffer(prevBuffer => {
            const newBuffer = [...prevBuffer, avg];
            if (newBuffer.length > WIDTH) { // Ширина осциллограммы равна ширине canvas
                newBuffer.shift();
            }
            return newBuffer;
        });

        oscCtx.fillStyle = 'rgb(240, 240, 240)';
        oscCtx.fillRect(0, 0, WIDTH, OSC_HEIGHT);

        oscCtx.lineWidth = 1;
        oscCtx.strokeStyle = 'rgb(0, 0, 0)';
        oscCtx.beginPath();
        
        const scaleY = OSC_HEIGHT / 255; // Масштаб 0-255 на высоту OSC_HEIGHT

        oscBuffer.forEach((val, i) => {
            const y = OSC_HEIGHT - val * scaleY;
            if (i === 0) {
                oscCtx.moveTo(i, y);
            } else {
                oscCtx.lineTo(i, y);
            }
        });

        oscCtx.stroke();
    };

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = 'rgb(240, 240, 240)';
      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

      const barWidth = (WIDTH / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // 1. Отрисовка частотного спектра
      let currentAvg = 0;
      let sum = 0;
      
      // Находим среднее значение в полосе пропускания для осциллограммы
      const centerFreqHz = 1600; // Hardcoded, should be passed as prop
      const bandwidthHz = 100; // Hardcoded, should be passed as prop
      const sampleRate = analyser.context.sampleRate;
      const binCount = dataArray.length;
      const nyquist = sampleRate / 2;
      const freqPerBin = nyquist / binCount;
      const centerBin = Math.floor(centerFreqHz / freqPerBin);
      const binRange = Math.ceil((bandwidthHz / 2) / freqPerBin);
      const lowBin = Math.max(0, centerBin - binRange);
      const highBin = Math.min(binCount - 1, centerBin + binRange);

      for (let i = lowBin; i <= highBin; i++) {
          sum += dataArray[i];
      }
      currentAvg = sum / (highBin - lowBin + 1);
      
      drawOscilloscope(currentAvg); // Отрисовка осциллограммы

      // Отрисовка частотного спектра (только для визуализации)
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];

        // Цветовая индикация активности
        const color = isTone ? `rgb(${barHeight + 100}, 50, 50)` : `rgb(${barHeight}, ${barHeight}, ${barHeight})`;
        
        canvasCtx.fillStyle = color;
        // Отрисовка от нижней границы
        const displayHeight = (Math.min(barHeight, MAX_VISUAL_VALUE) / MAX_VISUAL_VALUE) * HEIGHT;
        canvasCtx.fillRect(x, HEIGHT - displayHeight, barWidth, displayHeight);

        x += barWidth + 1;
      }
      
      // 2. Отрисовка порогов (noiseFloor и detectionThreshold)
      
      // Отрисовка Уровня Шума (Noise Floor)
      canvasCtx.strokeStyle = 'rgba(0, 123, 255, 0.7)'; // Синий
      canvasCtx.lineWidth = 2;
      canvasCtx.beginPath();
      const noiseY = valueToY(noiseFloor);
      canvasCtx.moveTo(0, noiseY);
      canvasCtx.lineTo(WIDTH, noiseY);
      canvasCtx.stroke();
      
      // Отрисовка Порога Обнаружения (Detection Threshold)
      canvasCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Красный
      canvasCtx.lineWidth = 2;
      canvasCtx.beginPath();
      const thresholdY = valueToY(detectionThreshold);
      canvasCtx.moveTo(0, thresholdY);
      canvasCtx.lineTo(WIDTH, thresholdY);
      canvasCtx.stroke();
      
      // Добавляем метки для ясности
      canvasCtx.fillStyle = 'rgba(0, 123, 255, 1)';
      canvasCtx.font = '10px Arial';
      canvasCtx.fillText(`Шум: ${noiseFloor.toFixed(1)}`, 5, noiseY - 5);
      
      canvasCtx.fillStyle = 'rgba(255, 0, 0, 1)';
      canvasCtx.fillText(`Порог: ${detectionThreshold.toFixed(1)}`, 5, thresholdY - 5);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyser, dataArray, bufferLength, isTone, noiseFloor, detectionThreshold, oscBuffer]);

  return (
    <div className="visualizer-container">
      <h3>Сетка звуков по частотам (Масштаб 0-50)</h3>
      <canvas ref={canvasRef} width="300" height="150" className="frequency-canvas"></canvas>
      
      <h3>Осциллограмма сигнала</h3>
      <canvas ref={oscCanvasRef} width="300" height="50" className="frequency-canvas"></canvas>
      
      <p className="visualizer-hint">
        <span className="dot" style={{backgroundColor: isTone ? 'red' : 'gray'}}></span> - Индикатор тона Морзе.
        <span style={{color: 'blue', marginLeft: '10px'}}>—</span> - Уровень шума.
        <span style={{color: 'red', marginLeft: '10px'}}>—</span> - Порог обнаружения (Чувствительность).
      </p>
    </div>
  );
};

export default FrequencyVisualizer;
