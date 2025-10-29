import React, { useRef, useEffect, useState, useCallback } from 'react';

// Принимаем новые параметры: detectionThreshold (теперь статический)
const FrequencyVisualizer = ({ analyser, isTone, detectionThreshold }) => {
  const canvasRef = useRef(null);
  const oscCanvasRef = useRef(null); // Canvas для осциллограммы
  const [dataArray, setDataArray] = useState(null);
  const [bufferLength, setBufferLength] = useState(0);
  
  // Буфер для осциллограммы: хранит состояния [isTone, avgLevel]
  const [oscBuffer, setOscBuffer] = useState([]); 
  const MAX_OSC_POINTS = 300; // Количество точек на осциллограмме (ширина canvas)
  const OSC_UPDATE_INTERVAL = 50; // Интервал обновления осциллограммы в мс (замедление)
  const lastOscUpdate = useRef(0);

  useEffect(() => {
    if (analyser) {
      const bLength = analyser.frequencyBinCount;
      setBufferLength(bLength);
      setDataArray(new Uint8Array(bLength));
    }
  }, [analyser]);

  const drawOscilloscope = useCallback((oscCtx, WIDTH, OSC_HEIGHT) => {
    oscCtx.fillStyle = 'rgb(240, 240, 240)';
    oscCtx.fillRect(0, 0, WIDTH, OSC_HEIGHT);

    // Отрисовка состояния тона
    oscCtx.lineWidth = 1;
    
    // Масштаб: 0-1 (isTone) на высоту OSC_HEIGHT
    const scaleY = OSC_HEIGHT; 
    const pointWidth = WIDTH / MAX_OSC_POINTS;

    oscBuffer.forEach((point, i) => {
        const [isToneState, avgLevel] = point;
        const x = i * pointWidth;
        
        // Цвет: Красный для тона, Серый для паузы
        oscCtx.fillStyle = isToneState ? 'rgba(255, 0, 0, 0.8)' : 'rgba(100, 100, 100, 0.2)';
        
        // Высота: 100% для тона, 10% для паузы
        const height = isToneState ? OSC_HEIGHT : OSC_HEIGHT * 0.1;
        const y = OSC_HEIGHT - height;

        oscCtx.fillRect(x, y, pointWidth + 1, height);
    });
    
    // Отрисовка линии, показывающей, где был бы порог, если бы мы его использовали
    // В данном случае, просто визуализация состояния тона
    
  }, [oscBuffer]);
  
  const drawFrequency = useCallback((canvasCtx, WIDTH, HEIGHT, dataArray, bufferLength, detectionThreshold) => {
    
    canvasCtx.fillStyle = 'rgb(240, 240, 240)';
    canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

    const barWidth = (WIDTH / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    // Масштабирование: растягиваем диапазон 0-50 на всю высоту графика
    const MAX_VISUAL_VALUE = 50; 
    const valueToY = (value) => HEIGHT - (Math.min(value, MAX_VISUAL_VALUE) / MAX_VISUAL_VALUE) * HEIGHT;

    // 1. Отрисовка частотного спектра
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
    
    // 2. Отрисовка Порога Обнаружения (Красная линия)
    canvasCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Красный
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    const thresholdY = valueToY(detectionThreshold);
    canvasCtx.moveTo(0, thresholdY);
    canvasCtx.lineTo(WIDTH, thresholdY);
    canvasCtx.stroke();
    
    // Добавляем метку для ясности
    canvasCtx.fillStyle = 'rgba(255, 0, 0, 1)';
    canvasCtx.font = '10px Arial';
    canvasCtx.fillText(`Порог: ${detectionThreshold}`, 5, thresholdY - 5);
    
  }, [isTone]);

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
    
    const loop = () => {
      animationFrameId = requestAnimationFrame(loop);

      analyser.getByteFrequencyData(dataArray);
      
      // Отрисовка спектра
      drawFrequency(canvasCtx, WIDTH, HEIGHT, dataArray, bufferLength, detectionThreshold);
      
      // Обновление буфера осциллограммы с замедлением
      const now = performance.now();
      if (now - lastOscUpdate.current > OSC_UPDATE_INTERVAL) {
        lastOscUpdate.current = now;
        
        // В данном случае, мы просто отображаем состояние isTone, которое приходит из App.jsx
        // Для более точной осциллограммы нужно передавать avgLevel из audioProcessor.js
        // Но для визуализации Точек/Тире достаточно состояния isTone.
        
        setOscBuffer(prevBuffer => {
            const newBuffer = [...prevBuffer, [isTone, 0]]; // 0 - заглушка для avgLevel
            if (newBuffer.length > MAX_OSC_POINTS) {
                newBuffer.shift();
            }
            return newBuffer;
        });
      }
      
      // Отрисовка осциллограммы
      drawOscilloscope(oscCtx, WIDTH, OSC_HEIGHT);
    };

    loop();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyser, dataArray, bufferLength, detectionThreshold, isTone, drawFrequency, drawOscilloscope]);

  return (
    <div className="visualizer-container">
      <h3>Сетка звуков по частотам (Порог 0-50)</h3>
      <canvas ref={canvasRef} width="300" height="150" className="frequency-canvas"></canvas>
      
      <h3>Осциллограмма Точек/Тире</h3>
      <canvas ref={oscCanvasRef} width="300" height="50" className="frequency-canvas"></canvas>
      
      <p className="visualizer-hint">
        <span className="dot" style={{backgroundColor: isTone ? 'red' : 'gray'}}></span> - Индикатор тона Морзе.
        <span style={{color: 'red', marginLeft: '10px'}}>—</span> - Статический порог обнаружения.
      </p>
    </div>
  );
};

export default FrequencyVisualizer;
