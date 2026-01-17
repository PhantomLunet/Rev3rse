"use client"

import type React from "react"

import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AudioVisualizer } from "@/components/audio-visualizer"
import { GamePhaseIndicator } from "@/components/game-phase-indicator"
import {
  Mic,
  Play,
  RotateCcw,
  Volume2,
  ArrowRight,
  Sparkles,
  MicOff,
  AlertCircle,
  Heart,
  Users,
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type GamePhase =
  | "setup"
  | "start"
  | "requesting-permission"
  | "recording-original"
  | "original-recorded"
  | "playing-reversed"
  | "recording-imitation"
  | "imitation-recorded"
  | "voting"
  | "reveal"
  | "game-over"

type MicPermissionState = "prompt" | "granted" | "denied" | "unsupported"

interface PlayerState {
  name: string
  lives: number
}

const MAX_LIVES = 3
const MAX_REVERSE_PLAYS = 2

export function ReverseAudioGame() {
  const [phase, setPhase] = useState<GamePhase>("setup")
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [originalAudio, setOriginalAudio] = useState<AudioBuffer | null>(null)
  const [reversedAudio, setReversedAudio] = useState<AudioBuffer | null>(null)
  const [imitationAudio, setImitationAudio] = useState<AudioBuffer | null>(null)
  const [reversedImitationAudio, setReversedImitationAudio] = useState<AudioBuffer | null>(null)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [micPermission, setMicPermission] = useState<MicPermissionState>("prompt")
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const [player1, setPlayer1] = useState<PlayerState>({ name: "", lives: MAX_LIVES })
  const [player2, setPlayer2] = useState<PlayerState>({ name: "", lives: MAX_LIVES })
  const [currentRecorder, setCurrentRecorder] = useState<1 | 2>(1)
  const [voteResult, setVoteResult] = useState<boolean | null>(null)
  const [roundCount, setRoundCount] = useState(1)
  const [reversedPlayCount, setReversedPlayCount] = useState(0)

  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    const checkMicrophoneSupport = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMicPermission("unsupported")
        setPermissionError(
          "Your browser doesn't support microphone access. Please try a modern browser like Chrome, Firefox, Safari, or Edge.",
        )
        return
      }

      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: "microphone" as PermissionName })
          setMicPermission(result.state as MicPermissionState)

          result.onchange = () => {
            setMicPermission(result.state as MicPermissionState)
            if (result.state === "granted") {
              setPermissionError(null)
            }
          }
        } catch {
          // Some browsers don't support querying microphone permission
        }
      }
    }

    checkMicrophoneSupport()
  }, [])

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  const reverseAudioBuffer = useCallback(
    (buffer: AudioBuffer): AudioBuffer => {
      const audioContext = getAudioContext()
      const reversedBuffer = audioContext.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)

      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const inputData = buffer.getChannelData(channel)
        const outputData = reversedBuffer.getChannelData(channel)
        for (let i = 0; i < buffer.length; i++) {
          outputData[i] = inputData[buffer.length - 1 - i]
        }
      }

      return reversedBuffer
    },
    [getAudioContext],
  )

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    setPermissionError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      stream.getTracks().forEach((track) => track.stop())
      setMicPermission("granted")
      return true
    } catch (error) {
      const err = error as Error

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setMicPermission("denied")
        setPermissionError(
          "Microphone access was denied. Please allow microphone access in your browser settings to play this game.",
        )
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setMicPermission("unsupported")
        setPermissionError("No microphone found. Please connect a microphone and try again.")
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setPermissionError(
          "Your microphone is being used by another application. Please close other apps using the mic and try again.",
        )
      } else if (err.name === "OverconstrainedError") {
        setPermissionError("Could not find a suitable microphone. Please try a different microphone.")
      } else {
        setPermissionError(`Could not access microphone: ${err.message}. Please check your device settings.`)
      }
      return false
    }
  }, [])

  const startRecording = useCallback(
    async (forImitation = false) => {
      setPermissionError(null)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100,
          },
        })

        streamRef.current = stream
        setMicPermission("granted")
        const audioContext = getAudioContext()

        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)
        setAnalyserNode(analyser)

        const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"]

        let selectedMimeType = ""
        for (const mimeType of mimeTypes) {
          if (MediaRecorder.isTypeSupported(mimeType)) {
            selectedMimeType = mimeType
            break
          }
        }

        const mediaRecorderOptions: MediaRecorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : {}

        const mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions)
        mediaRecorderRef.current = mediaRecorder
        chunksRef.current = []

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data)
          }
        }

        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: selectedMimeType || "audio/webm" })
          const arrayBuffer = await blob.arrayBuffer()

          try {
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

            if (forImitation) {
              setImitationAudio(audioBuffer)
              const reversedImitation = reverseAudioBuffer(audioBuffer)
              setReversedImitationAudio(reversedImitation)
              setPhase("imitation-recorded")
            } else {
              setOriginalAudio(audioBuffer)
              const reversed = reverseAudioBuffer(audioBuffer)
              setReversedAudio(reversed)
              setPhase("original-recorded")
            }
          } catch (decodeError) {
            console.error("Error decoding audio:", decodeError)
            setPermissionError("Failed to process the recording. Please try again.")
            setPhase(forImitation ? "playing-reversed" : "start")
          }

          setAnalyserNode(null)
          stream.getTracks().forEach((track) => track.stop())
        }

        mediaRecorder.start(100)
        setIsRecording(true)
        setPhase(forImitation ? "recording-imitation" : "recording-original")
      } catch (error) {
        const err = error as Error
        console.error("Error starting recording:", err)

        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setMicPermission("denied")
          setPermissionError("Microphone access was denied. Please allow microphone access in your browser settings.")
        } else if (err.name === "NotFoundError") {
          setPermissionError("No microphone found. Please connect a microphone and try again.")
        } else {
          setPermissionError(`Could not start recording: ${err.message}`)
        }
      }
    },
    [getAudioContext, reverseAudioBuffer],
  )

  const handleStartGame = useCallback(async () => {
    if (micPermission === "granted") {
      startRecording(false)
    } else {
      setPhase("requesting-permission")
      const hasPermission = await requestMicrophonePermission()
      if (hasPermission) {
        startRecording(false)
      } else {
        setPhase("start")
      }
    }
  }, [micPermission, requestMicrophonePermission, startRecording])

  const handleStartImitation = useCallback(async () => {
    if (micPermission === "granted") {
      startRecording(true)
    } else {
      const hasPermission = await requestMicrophonePermission()
      if (hasPermission) {
        startRecording(true)
      }
    }
  }, [micPermission, requestMicrophonePermission, startRecording])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [isRecording])

  const playAudio = useCallback(
    (buffer: AudioBuffer, onEnd?: () => void) => {
      const audioContext = getAudioContext()

      console.log("[v0] playAudio called, buffer:", buffer)
      console.log("[v0] AudioContext state:", audioContext.state)

      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop()
        } catch {
          // Source may already be stopped
        }
      }

      if (audioContext.state === "suspended") {
        console.log("[v0] Resuming suspended AudioContext")
        audioContext.resume().then(() => {
          console.log("[v0] AudioContext resumed, state:", audioContext.state)
          playBufferInternal(audioContext, buffer, onEnd)
        })
      } else {
        playBufferInternal(audioContext, buffer, onEnd)
      }
    },
    [getAudioContext],
  )

  const playBufferInternal = useCallback((audioContext: AudioContext, buffer: AudioBuffer, onEnd?: () => void) => {
    console.log("[v0] playBufferInternal called")

    const source = audioContext.createBufferSource()
    source.buffer = buffer

    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyser.connect(audioContext.destination)
    setAnalyserNode(analyser)

    console.log("[v0] Audio nodes connected to destination")

    source.onended = () => {
      console.log("[v0] Audio playback ended")
      setIsPlaying(false)
      setAnalyserNode(null)
      if (onEnd) onEnd()
    }

    sourceNodeRef.current = source
    source.start()
    console.log("[v0] Audio playback started")
    setIsPlaying(true)
  }, [])

  const playReversedAudio = useCallback(() => {
    console.log("[v0] playReversedAudio called, reversedAudio:", reversedAudio)
    if (reversedAudio && reversedPlayCount < MAX_REVERSE_PLAYS) {
      setPhase("playing-reversed")
      playAudio(reversedAudio)
      setReversedPlayCount((prev) => prev + 1)
    }
  }, [reversedAudio, playAudio, reversedPlayCount])

  const playImitationReversed = useCallback(() => {
    console.log("[v0] playImitationReversed called, reversedImitationAudio:", reversedImitationAudio)
    if (reversedImitationAudio) {
      playAudio(reversedImitationAudio)
    }
  }, [reversedImitationAudio, playAudio])

  const playOriginal = useCallback(() => {
    console.log("[v0] playOriginal called, originalAudio:", originalAudio)
    if (originalAudio) {
      playAudio(originalAudio)
    }
  }, [originalAudio, playAudio])

  const handleGoToVoting = useCallback(() => {
    setPhase("voting")
  }, [])

  const handleVote = useCallback(
    (wasClose: boolean) => {
      setVoteResult(wasClose)

      if (!wasClose) {
        // Deduct life from the imitating player
        const imitatorPlayer = currentRecorder === 1 ? player2 : player1
        const setImitatorPlayer = currentRecorder === 1 ? setPlayer2 : setPlayer1

        const newLives = imitatorPlayer.lives - 1
        setImitatorPlayer({ ...imitatorPlayer, lives: newLives })

        // Check for game over
        if (newLives <= 0) {
          setPhase("game-over")
          return
        }
      }

      setPhase("reveal")
    },
    [currentRecorder, player1, player2],
  )

  const nextRound = useCallback(() => {
    setOriginalAudio(null)
    setReversedAudio(null)
    setImitationAudio(null)
    setReversedImitationAudio(null)
    setIsRecording(false)
    setIsPlaying(false)
    setAnalyserNode(null)
    setPermissionError(null)
    setVoteResult(null)
    setCurrentRecorder(currentRecorder === 1 ? 2 : 1)
    setRoundCount(roundCount + 1)
    setReversedPlayCount(0)
    setPhase("start")
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop()
    }
  }, [currentRecorder, roundCount])

  const resetGame = useCallback(() => {
    setPhase("setup")
    setOriginalAudio(null)
    setReversedAudio(null)
    setImitationAudio(null)
    setReversedImitationAudio(null)
    setIsRecording(false)
    setIsPlaying(false)
    setAnalyserNode(null)
    setPermissionError(null)
    setVoteResult(null)
    setPlayer1({ name: "", lives: MAX_LIVES })
    setPlayer2({ name: "", lives: MAX_LIVES })
    setCurrentRecorder(1)
    setRoundCount(1)
    setReversedPlayCount(0)
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop()
    }
  }, [])

  const goBack = useCallback(() => {
    // Stop any ongoing recording or playback
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop()
      } catch {
        // Source may already be stopped
      }
    }
    setIsPlaying(false)
    setAnalyserNode(null)
    setPermissionError(null)

    // Navigate to previous phase based on current phase
    switch (phase) {
      case "start":
        setPhase("setup")
        break
      case "requesting-permission":
        setPhase("start")
        break
      case "recording-original":
        setPhase("start")
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
        }
        break
      case "original-recorded":
        setOriginalAudio(null)
        setReversedAudio(null)
        setPhase("start")
        break
      case "playing-reversed":
        setPhase("original-recorded")
        setReversedPlayCount(0) // Reset playback count when going back
        break
      case "recording-imitation":
        setPhase("playing-reversed")
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
        }
        break
      case "imitation-recorded":
        setImitationAudio(null)
        setReversedImitationAudio(null)
        setPhase("playing-reversed")
        break
      case "voting":
        setPhase("imitation-recorded")
        break
      case "reveal":
        if (voteResult === false) {
          const imitatorPlayer = currentRecorder === 1 ? player2 : player1
          const setImitatorPlayer = currentRecorder === 1 ? setPlayer2 : setPlayer1
          setImitatorPlayer({ ...imitatorPlayer, lives: imitatorPlayer.lives + 1 })
        }
        setVoteResult(null)
        setPhase("voting")
        break
      default:
        break
    }
  }, [phase, isRecording, voteResult, currentRecorder, player1, player2])

  const handleSetupSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (player1.name.trim() && player2.name.trim()) {
        setPhase("start")
      }
    },
    [player1.name, player2.name],
  )

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const recorder = currentRecorder === 1 ? player1 : player2
  const imitator = currentRecorder === 1 ? player2 : player1

  const LivesDisplay = ({ player, highlight }: { player: PlayerState; highlight?: boolean }) => (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${highlight ? "bg-primary/10 ring-2 ring-primary" : "bg-muted/50"}`}
    >
      <span className="font-medium text-sm truncate max-w-[100px]">{player.name}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: MAX_LIVES }).map((_, i) => (
          <Heart
            key={i}
            className={`h-4 w-4 ${i < player.lives ? "fill-red-500 text-red-500" : "text-muted-foreground/30"}`}
          />
        ))}
      </div>
    </div>
  )

  const BackButton = ({ disabled = false }: { disabled?: boolean }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={goBack}
      disabled={disabled}
      className="absolute top-4 left-4 text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 mr-1" />
      Back
    </Button>
  )

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-2xl">
        <header className="text-center mb-6">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2 tracking-tight">
            <span className="text-primary">Rev</span>3rse
          </h1>
          <p className="text-muted-foreground text-lg">Can you speak backwards?</p>
        </header>

        {phase !== "setup" && phase !== "game-over" && (
          <div className="flex justify-between items-center mb-4 gap-2">
            <LivesDisplay player={player1} highlight={currentRecorder === 1} />
            <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Round {roundCount}</div>
            <LivesDisplay player={player2} highlight={currentRecorder === 2} />
          </div>
        )}

        {phase !== "setup" && phase !== "game-over" && <GamePhaseIndicator phase={phase} />}

        <Card className="mt-6 border-2 border-border shadow-xl bg-card overflow-hidden relative">
          <CardContent className="p-6 md:p-8">
            {permissionError && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Microphone Access Required</AlertTitle>
                <AlertDescription className="mt-2">
                  {permissionError}
                  {micPermission === "denied" && (
                    <div className="mt-3 text-sm">
                      <strong>How to enable:</strong>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>Look for a camera/microphone icon in your browser&apos;s address bar</li>
                        <li>Click it and select &quot;Allow&quot; for microphone access</li>
                        <li>Or go to your browser settings and enable microphone for this site</li>
                      </ul>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {phase !== "setup" && phase !== "game-over" && (
              <AudioVisualizer analyser={analyserNode} isActive={isRecording || isPlaying} />
            )}

            <div className="mt-8 space-y-4">
              {phase === "setup" && (
                <form onSubmit={handleSetupSubmit} className="space-y-6">
                  <div className="text-center mb-6">
                    <Users className="h-12 w-12 mx-auto text-primary mb-3" />
                    <h2 className="text-xl font-semibold text-foreground">Enter Player Names</h2>
                    <p className="text-muted-foreground text-sm mt-1">Each player starts with 3 lives</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="player1">Player 1</Label>
                      <Input
                        id="player1"
                        placeholder="Enter name..."
                        value={player1.name}
                        onChange={(e) => setPlayer1({ ...player1, name: e.target.value })}
                        className="text-lg"
                        maxLength={20}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="player2">Player 2</Label>
                      <Input
                        id="player2"
                        placeholder="Enter name..."
                        value={player2.name}
                        onChange={(e) => setPlayer2({ ...player2, name: e.target.value })}
                        className="text-lg"
                        maxLength={20}
                        required
                      />
                    </div>
                  </div>

                  <div className="bg-muted/50 rounded-xl p-4">
                    <h3 className="font-medium mb-2 flex items-center gap-2">
                      <Heart className="h-4 w-4 text-red-500 fill-red-500" />
                      How Lives Work
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      After each round, players vote whether the imitation was close enough. If they vote
                      &quot;No&quot;, the imitating player loses a life. The game ends when a player runs out of lives!
                    </p>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={!player1.name.trim() || !player2.name.trim()}
                  >
                    Start Game
                  </Button>
                </form>
              )}

              {phase === "game-over" && (
                <div className="text-center space-y-6">
                  <BackButton />
                  <div className="bg-destructive/10 rounded-xl p-6 border border-destructive/30 mt-8">
                    <h3 className="text-2xl font-bold text-foreground mb-2">Game Over!</h3>
                    <p className="text-lg text-muted-foreground">
                      <span className="font-semibold text-primary">
                        {player1.lives > 0 ? player1.name : player2.name}
                      </span>{" "}
                      wins!
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      {player1.lives <= 0 ? player1.name : player2.name} ran out of lives
                    </p>
                  </div>
                  <div className="flex justify-center gap-4">
                    <LivesDisplay player={player1} />
                    <LivesDisplay player={player2} />
                  </div>
                  <Button size="lg" onClick={resetGame} className="px-8">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Play Again
                  </Button>
                </div>
              )}

              {phase === "start" && (
                <div className="text-center space-y-6">
                  <BackButton />
                  <div className="bg-muted/50 rounded-xl p-6 mt-8">
                    <h2 className="text-xl font-semibold mb-4 text-foreground">Round {roundCount}</h2>
                    <div className="space-y-3 text-left">
                      <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
                        <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                          <Mic className="h-4 w-4" />
                        </span>
                        <span>
                          <strong className="text-primary">{recorder.name}</strong> records a phrase
                        </span>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-secondary/10 rounded-lg">
                        <span className="bg-secondary text-secondary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                          <Volume2 className="h-4 w-4" />
                        </span>
                        <span>
                          <strong className="text-secondary">{imitator.name}</strong> listens to it reversed
                        </span>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-accent/10 rounded-lg">
                        <span className="bg-accent text-accent-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                          <Sparkles className="h-4 w-4" />
                        </span>
                        <span>
                          <strong className="text-accent-foreground">{imitator.name}</strong> imitates - then you both
                          vote!
                        </span>
                      </div>
                    </div>
                  </div>
                  {micPermission === "unsupported" ? (
                    <div className="flex flex-col items-center gap-3">
                      <MicOff className="h-12 w-12 text-muted-foreground" />
                      <p className="text-muted-foreground">Microphone not supported in this browser</p>
                    </div>
                  ) : (
                    <Button
                      size="lg"
                      onClick={handleStartGame}
                      className="w-full md:w-auto px-8 py-6 text-lg font-semibold"
                    >
                      <Mic className="mr-2 h-5 w-5" />
                      {recorder.name}, Start Recording
                    </Button>
                  )}
                </div>
              )}

              {phase === "requesting-permission" && (
                <div className="text-center space-y-4">
                  <BackButton />
                  <div className="w-20 h-20 mx-auto bg-primary/20 rounded-full flex items-center justify-center mt-8">
                    <div className="w-14 h-14 bg-primary rounded-full flex items-center justify-center">
                      <Mic className="h-7 w-7 text-primary-foreground" />
                    </div>
                  </div>
                  <p className="text-lg font-medium text-foreground">Requesting microphone access...</p>
                  <p className="text-sm text-muted-foreground">
                    Please allow microphone access when prompted by your browser
                  </p>
                </div>
              )}

              {phase === "recording-original" && (
                <div className="text-center space-y-4">
                  <BackButton disabled={isRecording} />
                  <div className="animate-pulse mt-8">
                    <div className="w-20 h-20 mx-auto bg-primary/20 rounded-full flex items-center justify-center">
                      <div className="w-14 h-14 bg-primary rounded-full flex items-center justify-center">
                        <Mic className="h-7 w-7 text-primary-foreground" />
                      </div>
                    </div>
                  </div>
                  <p className="text-lg font-medium text-foreground">{recorder.name}, say something!</p>
                  <p className="text-sm text-muted-foreground">{imitator.name} should look away!</p>
                  <Button size="lg" onClick={stopRecording} variant="destructive" className="px-8">
                    Stop Recording
                  </Button>
                </div>
              )}

              {phase === "original-recorded" && (
                <div className="text-center space-y-6">
                  <BackButton />
                  <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/30 mt-8">
                    <p className="text-green-600 dark:text-green-400 font-medium flex items-center justify-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      {recorder.name}&apos;s phrase recorded! Pass to {imitator.name}
                    </p>
                  </div>
                  <p className="text-muted-foreground">{imitator.name}: Listen carefully to the reversed audio</p>
                  <Button size="lg" onClick={playReversedAudio} className="px-8" disabled={isPlaying}>
                    <Volume2 className="mr-2 h-5 w-5" />
                    Play Reversed Audio
                  </Button>
                </div>
              )}

              {phase === "playing-reversed" && (
                <div className="text-center space-y-6">
                  <BackButton disabled={isPlaying} />
                  <div className="animate-pulse mt-8">
                    <div className="w-20 h-20 mx-auto bg-secondary/20 rounded-full flex items-center justify-center">
                      <div className="w-14 h-14 bg-secondary rounded-full flex items-center justify-center">
                        <Volume2 className="h-7 w-7 text-secondary-foreground" />
                      </div>
                    </div>
                  </div>
                  <p className="text-lg font-medium text-foreground">{imitator.name}, listen carefully!</p>
                  <p className="text-sm text-muted-foreground">Try to remember it and imitate it!</p>
                  <p className="text-xs text-muted-foreground">
                    Plays remaining: {MAX_REVERSE_PLAYS - reversedPlayCount} of {MAX_REVERSE_PLAYS}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button
                      size="lg"
                      onClick={playReversedAudio}
                      variant="outline"
                      disabled={isPlaying || reversedPlayCount >= MAX_REVERSE_PLAYS}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Play Again {reversedPlayCount >= MAX_REVERSE_PLAYS && "(Max reached)"}
                    </Button>
                    <Button size="lg" onClick={handleStartImitation} disabled={isPlaying}>
                      <Mic className="mr-2 h-4 w-4" />
                      Record Imitation
                    </Button>
                  </div>
                </div>
              )}

              {phase === "recording-imitation" && (
                <div className="text-center space-y-4">
                  <BackButton disabled={isRecording} />
                  <div className="animate-pulse mt-8">
                    <div className="w-20 h-20 mx-auto bg-accent/20 rounded-full flex items-center justify-center">
                      <div className="w-14 h-14 bg-accent rounded-full flex items-center justify-center">
                        <Mic className="h-7 w-7 text-accent-foreground" />
                      </div>
                    </div>
                  </div>
                  <p className="text-lg font-medium text-foreground">{imitator.name}, imitate it!</p>
                  <p className="text-sm text-muted-foreground">Try to copy the reversed audio!</p>
                  <Button size="lg" onClick={stopRecording} variant="destructive" className="px-8">
                    Stop Recording
                  </Button>
                </div>
              )}

              {phase === "imitation-recorded" && (
                <div className="text-center space-y-6">
                  <BackButton />
                  <div className="bg-accent/10 rounded-xl p-4 border border-accent/30 mt-8">
                    <p className="text-accent-foreground font-medium flex items-center justify-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      {imitator.name}&apos;s imitation recorded! Ready to vote?
                    </p>
                  </div>
                  <Button size="lg" onClick={handleGoToVoting} className="px-8">
                    <ArrowRight className="mr-2 h-5 w-5" />
                    Compare & Vote
                  </Button>
                </div>
              )}

              {phase === "voting" && (
                <div className="text-center space-y-6">
                  <BackButton disabled={isPlaying} />
                  <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-secondary/10 rounded-xl p-6 mt-8">
                    <h3 className="text-xl font-bold text-foreground mb-2">Listen & Compare!</h3>
                    <p className="text-muted-foreground text-sm">
                      Play both audios and decide if {imitator.name} got close enough
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Button
                      size="lg"
                      onClick={playOriginal}
                      variant="outline"
                      disabled={isPlaying}
                      className="flex flex-col h-auto py-4 bg-transparent"
                    >
                      <Play className="h-6 w-6 mb-1" />
                      <span className="font-semibold">Original</span>
                      <span className="text-xs text-muted-foreground">What {recorder.name} said</span>
                    </Button>
                    <Button
                      size="lg"
                      onClick={playImitationReversed}
                      disabled={isPlaying}
                      variant="secondary"
                      className="flex flex-col h-auto py-4"
                    >
                      <Play className="h-6 w-6 mb-1" />
                      <span className="font-semibold">Imitation Reversed</span>
                      <span className="text-xs text-muted-foreground">What {imitator.name} tried to say</span>
                    </Button>
                  </div>

                  <div className="border-t border-border pt-6 mt-6">
                    <h4 className="text-lg font-semibold text-foreground mb-4">
                      Was {imitator.name}&apos;s imitation close enough?
                    </h4>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                      <Button
                        size="lg"
                        onClick={() => handleVote(true)}
                        disabled={isPlaying}
                        className="bg-green-600 hover:bg-green-700 text-white px-8 py-6"
                      >
                        <ThumbsUp className="mr-2 h-5 w-5" />
                        Yes, Close Enough!
                      </Button>
                      <Button
                        size="lg"
                        onClick={() => handleVote(false)}
                        disabled={isPlaying}
                        variant="destructive"
                        className="px-8 py-6"
                      >
                        <ThumbsDown className="mr-2 h-5 w-5" />
                        No, Not Close
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Voting &quot;No&quot; will cost {imitator.name} a life!
                    </p>
                  </div>
                </div>
              )}

              {phase === "reveal" && (
                <div className="text-center space-y-6">
                  <BackButton disabled={isPlaying} />
                  <div
                    className={`rounded-xl p-6 border mt-8 ${voteResult ? "bg-green-500/10 border-green-500/30" : "bg-destructive/10 border-destructive/30"}`}
                  >
                    <div className="text-4xl mb-2">
                      {voteResult ? (
                        <ThumbsUp className="h-12 w-12 mx-auto text-green-600" />
                      ) : (
                        <ThumbsDown className="h-12 w-12 mx-auto text-destructive" />
                      )}
                    </div>
                    <p
                      className={`text-lg font-medium ${voteResult ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
                    >
                      {voteResult ? `${imitator.name} nailed it!` : `${imitator.name} lost a life!`}
                    </p>
                  </div>
                  <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-secondary/10 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-foreground mb-2">Listen Again</h3>
                    <p className="text-muted-foreground text-sm">
                      Original vs {imitator.name}&apos;s reversed imitation
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Button
                      size="lg"
                      onClick={playOriginal}
                      variant="outline"
                      disabled={isPlaying}
                      className="flex flex-col h-auto py-4 bg-transparent"
                    >
                      <Play className="h-6 w-6 mb-1" />
                      <span className="font-semibold">Original</span>
                      <span className="text-xs text-muted-foreground">What {recorder.name} said</span>
                    </Button>
                    <Button
                      size="lg"
                      onClick={playImitationReversed}
                      disabled={isPlaying}
                      className="flex flex-col h-auto py-4"
                    >
                      <Play className="h-6 w-6 mb-1" />
                      <span className="font-semibold">Imitation Reversed</span>
                      <span className="text-xs text-primary-foreground/70">Did {imitator.name} match it?</span>
                    </Button>
                  </div>
                  <Button size="lg" onClick={nextRound} variant="secondary" className="mt-4">
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Next Round (Swap Roles)
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <footer className="mt-8 text-center text-sm text-muted-foreground">
          <p>Made for party fun!</p>
        </footer>
      </div>
    </div>
  )
}
