import React, { useRef, useEffect, useState } from 'react';

// Принимаем новые параметры: noiseFloor и detectionThreshold
const FrequencyVisualizer = ({ analyser, isTone, noiseFloor, detectionThreshold }) => {
  const canvasRef = useRef(null);
  const [dataArray, setDataArray] = useState(null);
  const [bufferLength, setBufferLength] = useState(0);

  useEffect(() => {
    if (analyser) {
      const bLength = analyser.frequencyBinCount;
      setBufferLength(bLength);
      // Используем Float32Array для getFloatFrequencyData, но для getByteFrequencyData нужен Uint8Array
      // Поскольку мы используем getByteFrequencyData (0-255), оставим Uint8Array
      setDataArray(new Uint8Array(bLength));
    }
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || !dataArray) return;

    const canvasCtx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    let animationFrameId;

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = 'rgb(240, 240, 240)';
      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

      const barWidth = (WIDTH / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // 1. Отрисовка частотного спектра
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];

        // Цветовая индикация активности
        const color = isTone ? `rgb(${barHeight + 100}, 50, 50)` : `rgb(${barHeight}, ${barHeight}, ${barHeight})`;
        
        canvasCtx.fillStyle = color;
        // Отрисовка от нижней границы
        canvasCtx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
      
      // 2. Отрисовка порогов (noiseFloor и detectionThreshold)
      // Значения noiseFloor и detectionThreshold находятся в диапазоне 0-255 (как и dataArray)
      
      // Конвертируем значение 0-255 в координату Y (от 0 до HEIGHT)
      const valueToY = (value) => HEIGHT - value * (HEIGHT / 255);

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
  }, [analyser, dataArray, bufferLength, isTone, noiseFloor, detectionThreshold]);

  return (
    <div className="visualizer-container">
      <h3>Сетка звуков по частотам</h3>
      <canvas ref={canvasRef} width="300" height="150" className="frequency-canvas"></canvas>
      <p className="visualizer-hint">
        <span className="dot" style={{backgroundColor: isTone ? 'red' : 'gray'}}></span> - Индикатор тона Морзе.
        <span style={{color: 'blue', marginLeft: '10px'}}>—</span> - Уровень шума.
        <span style={{color: 'red', marginLeft: '10px'}}>—</span> - Порог обнаружения (Чувствительность).
      </p>
    </div>
  );
};

export default FrequencyVisualizer;
