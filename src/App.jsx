import React, {useState, useEffect, useRef, useMemo, useCallback} from 'react'
import { db } from './firebaseConfig'
import { ref, set, push, onValue, onDisconnect, remove } from 'firebase/database'
import { AudioMorseReceiver } from './audioProcessor'
import { decodeSymbol } from './morseDecoder'
import FrequencyVisualizer from './FrequencyVisualizer.jsx'

// Перевод
const T = {
  title: 'Приемник Азбуки Морзе в реальном времени (PWA)',
  createRoom: 'Создать Комнату',
  roomIdPlaceholder: 'ID Комнаты',
  joinViewer: 'Присоединиться (наблюдатель)',
  joinHost: 'Присоединиться (приемник)',
  wpm: 'Скорость (WPM)',
  dashDotRatio: 'Соотношение Тире/Точка',
  pauseMultiplier: 'Множитель Паузы',
  sensitivity: 'Порог Чувствительности (0-50)', // Изменено название
  noiseGate: 'Шумодав (мс)',
  startReceiving: 'Начать Прием (микрофон)',
  stopReceiving: 'Остановить',
  decodedStream: 'Декодированный поток',
  joinRoomFirst: 'Сначала присоединитесь к комнате',
  mode: 'Режим декодирования',
  modeLetters: 'Буквы',
  modeDigits: 'Цифры',
  hostControls: 'Управление приемником',
  roomControls: 'Управление комнатой',
  settings: 'Настройки',
  logs: 'Журнал приема',
  lastGroup: 'Последняя группа (5 символов):',
  fullText: 'Полный текст:',
  onlyHost: 'Только владелец комнаты может управлять приемом.',
}

// Уникальный ID клиента
function uid(){ return Math.random().toString(36).slice(2,9) }

export default function App(){
  const [roomId, setRoomId] = useState('')
  const [joinedRoom, setJoinedRoom] = useState(null)
  const [isHost, setIsHost] = useState(false)
  
  // Настройки декодирования
  const [wpm, setWpm] = useState(60) // Скорость (WPM)
  const [dashDotRatio, setDashDotRatio] = useState(4.5) // Соотношение Тире/Точка
  const [pauseMultiplier, setPauseMultiplier] = useState(5.5) // Множитель Паузы
  
  // Новые настройки обнаружения сигнала (Статический Порог)
  const [sensitivity, setSensitivity] = useState(15) // Абсолютный порог (1-50)
  const [noiseGate, setNoiseGate] = useState(20) // Минимальная длительность тона (мс)
  
  const [decodeMode, setDecodeMode] = useState('letters') // 'letters' or 'digits'
  const [logs, setLogs] = useState([])
  const [analyser, setAnalyser] = useState(null)
  const [isTone, setIsTone] = useState(false)
  const [detectionThreshold, setDetectionThreshold] = useState(0) // Порог обнаружения (теперь статический)
  
  const receiverRef = useRef(null)
  const clientIdRef = useRef(uid())
  const lastCharRef = useRef(null)

  // Обновление логов
  useEffect(()=>{
    if(joinedRoom){
      const messagesRef = ref(db, `rooms/${joinedRoom}/messages`)
      const unsubscribe = onValue(messagesRef, snapshot=>{
        const data = snapshot.val() || {}
        const arr = Object.values(data).sort((a, b) => a.ts - b.ts)
        setLogs(arr)
      })
      return () => unsubscribe()
    }
  },[joinedRoom])

  // Группировка символов для отображения
  const { currentGroup, fullText } = useMemo(() => {
    let currentGroup = '';
    let fullText = '';
    let charCount = 0;
    
    // Фильтруем символы, чтобы не включать в текст служебные символы
    const chars = logs.map(m => m.char).filter(c => c !== null && c !== undefined);

    for (const char of chars) {
      if (char === ' ' || char === '  ') {
        fullText += (char === '  ' ? ' / ' : ' ');
      } else if (char !== '?') {
        fullText += char;
      }
    }
    
    // Формирование последней группы из 5 символов
    const cleanChars = chars.filter(c => c !== ' ' && c !== '  ' && c !== '?');
    for(let i = cleanChars.length - 1; i >= 0; i--) {
      currentGroup = cleanChars[i] + currentGroup;
      charCount++;
      if (charCount >= 5) break;
    }

    return { currentGroup, fullText };
  }, [logs]);

  const createRoom = useCallback(async () => {
    const id = Math.random().toString(36).slice(2,8).toUpperCase()
    setRoomId(id)
    await set(ref(db, `rooms/${id}`), {
      created: Date.now(), 
      mode: decodeMode,
      wpm,
      dashDotRatio,
      pauseMultiplier,
      sensitivity,
      noiseGate
    })
    joinRoom(id, true)
  }, [decodeMode, wpm, dashDotRatio, pauseMultiplier, sensitivity, noiseGate])

  const joinRoom = useCallback(async (id, asHost=false) => {
    if (!id) return
    setJoinedRoom(id)
    setIsHost(asHost)
    
    const clientRef = ref(db, `rooms/${id}/clients/${clientIdRef.current}`)
    await set(clientRef, {connected: true, ts: Date.now(), host: asHost})
    onDisconnect(clientRef).remove()

    const roomRef = ref(db, `rooms/${id}`)
    onValue(roomRef, (snapshot) => {
      const roomData = snapshot.val()
      if (roomData) {
        setDecodeMode(roomData.mode || 'letters')
        setWpm(roomData.wpm || 60)
        setDashDotRatio(roomData.dashDotRatio || 4.5)
        setPauseMultiplier(roomData.pauseMultiplier || 5.5)
        setSensitivity(roomData.sensitivity || 15)
        setNoiseGate(roomData.noiseGate || 20)
      }
    })
  }, [])

  // Обновление настроек в базе данных
  useEffect(() => {
    if (joinedRoom && isHost) {
      set(ref(db, `rooms/${joinedRoom}/mode`), decodeMode)
      set(ref(db, `rooms/${joinedRoom}/wpm`), wpm)
      set(ref(db, `rooms/${joinedRoom}/dashDotRatio`), dashDotRatio)
      set(ref(db, `rooms/${joinedRoom}/pauseMultiplier`), pauseMultiplier)
      set(ref(db, `rooms/${joinedRoom}/sensitivity`), sensitivity)
      set(ref(db, `rooms/${joinedRoom}/noiseGate`), noiseGate)
    }
  }, [decodeMode, wpm, dashDotRatio, pauseMultiplier, sensitivity, noiseGate, joinedRoom, isHost])
  
  // Устанавливаем detectionThreshold равным sensitivity (статический порог)
  useEffect(() => {
    setDetectionThreshold(sensitivity)
  }, [sensitivity])

  const handleSymbol = useCallback(async (seq, gapType) => {
    const char = decodeSymbol(seq, decodeMode)
    
    // Добавляем пробел, если есть межсимвольная/межсловная пауза
    if (gapType === ' ' || gapType === '  ') {
        // Отправка пробела в БД
        const gapMsgRef = push(ref(db, `rooms/${joinedRoom}/messages`))
        await set(gapMsgRef, {char: gapType.trim(), seq: '', ts: Date.now(), from: clientIdRef.current})
        lastCharRef.current = gapType.trim()
    }

    // Отправка символа в БД
    const msgRef = push(ref(db, `rooms/${joinedRoom}/messages`))
    await set(msgRef, {char, seq, ts: Date.now(), from: clientIdRef.current})
    lastCharRef.current = char
  }, [joinedRoom, decodeMode])

  const startReceiving = useCallback(async () => {
    if(!joinedRoom) return alert(T.joinRoomFirst)
    if(receiverRef.current) receiverRef.current.stop()

    receiverRef.current = new AudioMorseReceiver({
      onSymbol: handleSymbol,
      onRawToggle: (isTone, level)=>{ // Убран noiseFloor и detectionThreshold
        setIsTone(isTone)
      },
      centerFreqHz: 1600,
      bandwidthHz: 100, // Уменьшено для избирательности
      fftSize: 2048,
      sampleRate: 44100,
      // Передача новых настроек
      dashDotRatio: dashDotRatio,
      pauseMultiplier: pauseMultiplier,
      staticThreshold: sensitivity, // Передаем статический порог
      minToneDurationMs: noiseGate
    })
    receiverRef.current.setWPM(wpm)
    await receiverRef.current.start()
    setAnalyser(receiverRef.current.analyser)
  }, [joinedRoom, wpm, dashDotRatio, pauseMultiplier, sensitivity, noiseGate, handleSymbol])

  const stopReceiving = useCallback(() => {
    receiverRef.current && receiverRef.current.stop()
    setAnalyser(null)
  }, [])

  // Вспомогательная функция для форматирования текста с группировкой по 5 символов
  const formatTextWithGroups = (text) => {
    let result = '';
    let charCount = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === ' ') {
            result += char;
        } else if (char === '/') {
            result += char;
        } else {
            result += char;
            charCount++;
            if (charCount % 5 === 0 && i < text.length - 1 && text[i+1] !== ' ' && text[i+1] !== '/') {
                result += ' '; // Добавляем пробел после каждой группы из 5 символов
            }
        }
    }
    return result;
  }
  
  const formattedFullText = formatTextWithGroups(fullText);

  return (
    <div className="app">
      <h1>{T.title}</h1>

      <section className="room-controls">
        <h2>{T.roomControls}</h2>
        <div className="controls">
          <button onClick={createRoom}>{T.createRoom}</button>
          <input placeholder={T.roomIdPlaceholder} value={roomId} onChange={e=>setRoomId(e.target.value.toUpperCase())} />
          <button onClick={()=>joinRoom(roomId,false)} disabled={!roomId}>{T.joinViewer}</button>
          <button onClick={()=>joinRoom(roomId,true)} disabled={!roomId}>{T.joinHost}</button>
        </div>
        {joinedRoom && <p>Вы в комнате: <b>{joinedRoom}</b>. Режим: <b>{isHost ? 'Приемник' : 'Наблюдатель'}</b></p>}
      </section>

      <section className="settings">
        <h2>{T.settings}</h2>
        
        {/* Настройка WPM */}
        <div className="setting-item">
          <label>{T.wpm} ({wpm})</label>
          <input 
            type="range" 
            min={30} 
            max={150} 
            step={5}
            value={wpm} 
            onChange={e=>setWpm(Number(e.target.value))} 
            disabled={!isHost}
          />
        </div>

        {/* Настройка Соотношения Тире/Точка */}
        <div className="setting-item">
          <label>{T.dashDotRatio} ({dashDotRatio.toFixed(1)})</label>
          <input 
            type="range" 
            min={2.0} 
            max={4.5} 
            step={0.1}
            value={dashDotRatio} 
            onChange={e=>setDashDotRatio(Number(e.target.value))} 
            disabled={!isHost}
          />
        </div>

        {/* Настройка Множителя Паузы */}
        <div className="setting-item">
          <label>{T.pauseMultiplier} (x{pauseMultiplier.toFixed(1)})</label>
          <input 
            type="range" 
            min={1.0} 
            max={6.0} 
            step={0.1}
            value={pauseMultiplier} 
            onChange={e=>setPauseMultiplier(Number(e.target.value))} 
            disabled={!isHost}
          />
        </div>

        {/* Настройка Чувствительности (Статический Порог) */}
        <div className="setting-item">
          <label>{T.sensitivity} ({sensitivity})</label>
          <input 
            type="range" 
            min={1} 
            max={50} 
            step={1}
            value={sensitivity} 
            onChange={e=>setSensitivity(Number(e.target.value))} 
            disabled={!isHost}
          />
        </div>

        {/* Настройка Шумодава */}
        <div className="setting-item">
          <label>{T.noiseGate} ({noiseGate} мс)</label>
          <input 
            type="range" 
            min={0} 
            max={200} 
            step={5}
            value={noiseGate} 
            onChange={e=>setNoiseGate(Number(e.target.value))} 
            disabled={!isHost}
          />
        </div>

        {/* Режим декодирования */}
        <div className="setting-item">
          <label>{T.mode}</label>
          <button onClick={() => setDecodeMode('letters')} disabled={decodeMode === 'letters' || !isHost}>{T.modeLetters}</button>
          <button onClick={() => setDecodeMode('digits')} disabled={decodeMode === 'digits' || !isHost}>{T.modeDigits}</button>
          {!isHost && <p>Режим установлен владельцем комнаты: <b>{decodeMode === 'letters' ? T.modeLetters : T.modeDigits}</b></p>}
        </div>
      </section>

      <section className="host-controls">
        <h2>{T.hostControls}</h2>
        {isHost ? (
          <>
            <button onClick={startReceiving}>{T.startReceiving}</button>
            <button onClick={stopReceiving}>{T.stopReceiving}</button>
            {analyser && <FrequencyVisualizer 
              analyser={analyser} 
              isTone={isTone} 
              detectionThreshold={detectionThreshold} // Передаем статический порог
            />}
          </>
        ) : (
          <p>{T.onlyHost}</p>
        )}
      </section>

      <section className="logs">
        <h2>{T.logs}</h2>
        
        <div className="full-text">
          <h3>{T.fullText}</h3>
          <p className="full-text-display">{formattedFullText || 'Ожидание приема...'}</p>
        </div>
        
        <div className="current-group">
          <h3>{T.lastGroup}</h3>
          <p className="group-display">{currentGroup.padEnd(5, '_')}</p>
        </div>
        
        <div className="stream">
          <h3>{T.decodedStream}</h3>
          {logs.slice(-50).map((m, i)=> (
            <div key={i} className="msg">{new Date(m.ts).toLocaleTimeString()} — <b>{m.char}</b> <small>({m.seq})</small></div>
          ))}
        </div>
      </section>
    </div>
  )
}
