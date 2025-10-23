import React, {useState, useEffect, useRef} from 'react'
import { db } from './firebaseConfig'
import { ref, set, push, onValue, onDisconnect, remove } from 'firebase/database'
import { AudioMorseReceiver } from './audioProcessor'
import { decodeSymbol } from './morseDecoder'

function uid(){ return Math.random().toString(36).slice(2,9) }

export default function App(){
  const [roomId, setRoomId] = useState('')
  const [joinedRoom, setJoinedRoom] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [groupsPerMin, setGroupsPerMin] = useState(7)
  const [logs, setLogs] = useState([])
  const receiverRef = useRef(null)
  const clientIdRef = useRef(uid())

  useEffect(()=>{
    if(joinedRoom){
      const messagesRef = ref(db, `rooms/${joinedRoom}/messages`)
      onValue(messagesRef, snapshot=>{
        const data = snapshot.val() || {}
        const arr = Object.values(data)
        setLogs(arr)
      })
    }
  },[joinedRoom])

  async function createRoom(){
    const id = Math.random().toString(36).slice(2,8)
    setRoomId(id)
    await set(ref(db, `rooms/${id}`), {created: Date.now()})
    joinRoom(id, true)
  }

  async function joinRoom(id, asHost=false){
    setJoinedRoom(id)
    setIsHost(asHost)
    // presence via clients list
    const clientRef = ref(db, `rooms/${id}/clients/${clientIdRef.current}`)
    set(clientRef, {connected: true, ts: Date.now(), host: asHost})
    onDisconnect(clientRef).remove()
  }

  async function startReceiving(){
    if(!joinedRoom) return alert('Join a room first')
    receiverRef.current = new AudioMorseReceiver({onSymbol: async(seq)=>{
      const char = decodeSymbol(seq)
      // send to db
      const msgRef = push(ref(db, `rooms/${joinedRoom}/messages`))
      await set(msgRef, {char, seq, ts: Date.now(), from: clientIdRef.current})
    }, onRawToggle: (isTone, level)=>{
      // optionally send telemetry, but avoid spamming
    }})
    receiverRef.current.setWPM(groupsPerMin)
    await receiverRef.current.start()
  }

  function stopReceiving(){
    receiverRef.current && receiverRef.current.stop()
  }

  return (
    <div className="app">
      <h1>Morse Audio Realtime (PWA)</h1>
      <div className="controls">
        <button onClick={createRoom}>Create Room</button>
        <input placeholder="Room ID" value={roomId} onChange={e=>setRoomId(e.target.value)} />
        <button onClick={()=>joinRoom(roomId,false)}>Join Room (viewer)</button>
        <button onClick={()=>joinRoom(roomId,true)}>Join as Host (receiver)</button>
      </div>

      <div className="settings">
        <label>Groups / min (6..9)</label>
        <input type="range" min={6} max={9} value={groupsPerMin} onChange={e=>setGroupsPerMin(Number(e.target.value))} />
        <span>{groupsPerMin}</span>
      </div>

      <div className="host-controls">
        {isHost && <>
          <button onClick={startReceiving}>Start Receiving (microphone)</button>
          <button onClick={stopReceiving}>Stop</button>
        </>}
      </div>

      <div className="logs">
        <h2>Decoded stream</h2>
        <div className="stream">
          {logs.map((m, i)=> (
            <div key={i} className="msg">{new Date(m.ts).toLocaleTimeString()} — <b>{m.char}</b> <small>({m.seq})</small></div>
          ))}
        </div>
      </div>
    </div>
  )
}