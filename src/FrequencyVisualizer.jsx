import React, { useRef, useEffect, useState } from 'react';

const FrequencyVisualizer = ({ analyser, isTone }) => {
  const canvasRef = useRef(null);
  const [dataArray, setDataArray] = useState(null);
  const [bufferLength, setBufferLength] = useState(0);

  useEffect(() => {
    if (analyser) {
      const bLength = analyser.frequencyBinCount;
      setBufferLength(bLength);
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

      canvasCtx.fillStyle = 'rgb(200, 200, 200)';
      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

      const barWidth = (WIDTH / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];

        // Цветовая индикация активности
        const color = isTone ? `rgb(${barHeight + 100}, 50, 50)` : `rgb(${barHeight}, ${barHeight}, ${barHeight})`;
        
        canvasCtx.fillStyle = color;
        canvasCtx.fillRect(x, HEIGHT - barHeight / 2, barWidth, barHeight / 2);

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyser, dataArray, bufferLength, isTone]);

  return (
    <div className="visualizer-container">
      <h3>Сетка звуков по частотам</h3>
      <canvas ref={canvasRef} width="300" height="150" className="frequency-canvas"></canvas>
      <p className="visualizer-hint">
        <span className="dot"></span> - Индикатор тона Морзе.
      </p>
    </div>
  );
};

export default FrequencyVisualizer;
