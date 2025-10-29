import React, {useState, useEffect, useRef, useMemo, useCallback} from 'react'
import { db } from './firebaseConfig'
import { ref, set, push, onValue, onDisconnect, remove } from 'firebase/database'
import { AudioMorseReceiver } from './audioProcessor'
import { decodeSymbol } from './morseDecoder'
import FrequencyVisualizer from './FrequencyVisualizer.jsx' // Импорт визуализатора

// Перевод
const T = {
  title: 'Приемник Азбуки Морзе в реальном времени (PWA)',
  createRoom: 'Создать Комнату',
  roomIdPlaceholder: 'ID Комнаты',
  joinViewer: 'Присоединиться (наблюдатель)',
  joinHost: 'Присоединиться (приемник)',
  groupsPerMin: 'Групп в минуту (6..9)',
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
}

// Уникальный ID клиента
function uid(){ return Math.random().toString(36).slice(2,9) }

export default function App(){
  const [roomId, setRoomId] = useState('')
  const [joinedRoom, setJoinedRoom] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [groupsPerMin, setGroupsPerMin] = useState(7)
  const [decodeMode, setDecodeMode] = useState('letters') // 'letters' or 'digits'
  const [logs, setLogs] = useState([])
  const [currentGroup, setCurrentGroup] = useState('')
  const [analyser, setAnalyser] = useState(null) // Состояние для AnalyserNode
  const [isTone, setIsTone] = useState(false) // Состояние для индикации тона
  const receiverRef = useRef(null)
  const clientIdRef = useRef(uid())
  const lastCharRef = useRef(null)

  // Обновление логов и группировка по 5 символов
  useEffect(()=>{
    if(joinedRoom){
      const messagesRef = ref(db, `rooms/${joinedRoom}/messages`)
      const unsubscribe = onValue(messagesRef, snapshot=>{
        const data = snapshot.val() || {}
        const arr = Object.values(data).sort((a, b) => a.ts - b.ts) // Сортировка по времени
        setLogs(arr)
      })
      return () => unsubscribe()
    }
  },[joinedRoom])

  // Группировка символов для отображения
  useEffect(() => {
    const chars = logs.map(m => m.char).filter(c => c !== ' ')
    let group = ''
    let charCount = 0
    for(let i = chars.length - 1; i >= 0; i--) {
      if (chars[i] !== '?') {
        group = chars[i] + group
        charCount++
        if (charCount >= 5) break
      }
    }
    setCurrentGroup(group)
  }, [logs])

  const createRoom = useCallback(async () => {
    const id = Math.random().toString(36).slice(2,8).toUpperCase()
    setRoomId(id)
    await set(ref(db, `rooms/${id}`), {created: Date.now(), mode: decodeMode})
    joinRoom(id, true)
  }, [decodeMode])

  const joinRoom = useCallback(async (id, asHost=false) => {
    if (!id) return
    setJoinedRoom(id)
    setIsHost(asHost)
    // Присутствие через список клиентов
    const clientRef = ref(db, `rooms/${id}/clients/${clientIdRef.current}`)
    await set(clientRef, {connected: true, ts: Date.now(), host: asHost})
    onDisconnect(clientRef).remove()

    // Если наблюдатель, синхронизировать режим декодирования
    if (!asHost) {
      const roomRef = ref(db, `rooms/${id}`)
      onValue(roomRef, (snapshot) => {
        const roomData = snapshot.val()
        if (roomData && roomData.mode) {
          setDecodeMode(roomData.mode)
        }
      }, { onlyOnce: true })
    }
  }, [])

  // Обновление режима декодирования в базе данных
  useEffect(() => {
    if (joinedRoom && isHost) {
      set(ref(db, `rooms/${joinedRoom}/mode`), decodeMode)
    }
  }, [decodeMode, joinedRoom, isHost])

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
    if(receiverRef.current) receiverRef.current.stop() // Остановить предыдущий, если есть

    receiverRef.current = new AudioMorseReceiver({
      onSymbol: handleSymbol,
      onRawToggle: (isTone, level)=>{
        setIsTone(isTone) // Обновление состояния для визуализатора
      },
      centerFreqHz: 1600, // Центральная частота для Bandpass
      bandwidthHz: 400,   // Ширина полосы для Bandpass
      fftSize: 2048,
      sampleRate: 44100
    })
    receiverRef.current.setWPM(groupsPerMin)
    await receiverRef.current.start()
    setAnalyser(receiverRef.current.analyser) // Установка AnalyserNode для визуализатора
  }, [joinedRoom, groupsPerMin, handleSymbol])

  const stopReceiving = useCallback(() => {
    receiverRef.current && receiverRef.current.stop()
    setAnalyser(null) // Очистка AnalyserNode
  }, [])

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
        <div className="setting-item">
          <label>{T.groupsPerMin}</label>
          <input type="range" min={6} max={9} value={groupsPerMin} onChange={e=>setGroupsPerMin(Number(e.target.value))} />
          <span>{groupsPerMin}</span>
        </div>
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
            {analyser && <FrequencyVisualizer analyser={analyser} isTone={isTone} />}
          </>
        ) : (
          <p>Только владелец комнаты может управлять приемом.</p>
        )}
      </section>

      <section className="logs">
        <h2>{T.logs}</h2>
        <div className="current-group">
          <h3>Последняя группа (5 символов):</h3>
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
