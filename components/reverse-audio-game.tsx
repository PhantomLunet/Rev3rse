"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AudioVisualizer } from "@/components/audio-visualizer"
import { GamePhaseIndicator } from "@/components/game-phase-indicator"
import { Mic, Play, RotateCcw, Volume2, ArrowRight, Sparkles, MicOff, AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type GamePhase =
  | "start"
  | "requesting-permission"
  | "recording-original"
  | "original-recorded"
  | "playing-reversed"
  | "recording-imitation"
  | "imitation-recorded"
  | "reveal"

type MicPermissionState = "prompt" | "granted" | "denied" | "unsupported"

export function ReverseAudioGame() {
  const [phase, setPhase] = useState<GamePhase>("start")
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [originalAudio, setOriginalAudio] = useState<AudioBuffer | null>(null)
  const [reversedAudio, setReversedAudio] = useState<AudioBuffer | null>(null)
  const [imitationAudio, setImitationAudio] = useState<AudioBuffer | null>(null)
  const [reversedImitationAudio, setReversedImitationAudio] = useState<AudioBuffer | null>(null)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [micPermission, setMicPermission] = useState<MicPermissionState>("prompt")
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    const checkMicrophoneSupport = async () => {
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMicPermission("unsupported")
        setPermissionError(
          "Your browser doesn't support microphone access. Please try a modern browser like Chrome, Firefox, Safari, or Edge.",
        )
        return
      }

      // Check permission state if the API is available
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: "microphone" as PermissionName })
          setMicPermission(result.state as MicPermissionState)

          // Listen for permission changes
          result.onchange = () => {
            setMicPermission(result.state as MicPermissionState)
            if (result.state === "granted") {
              setPermissionError(null)
            }
          }
        } catch {
          // Some browsers don't support querying microphone permission
          // We'll find out when we try to access it
        }
      }
    }

    checkMicrophoneSupport()
  }, [])

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    // Resume context if it's suspended (required on iOS/Safari after user interaction)
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
      // Permission granted - stop the test stream
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
            console.error("[v0] Error decoding audio:", decodeError)
            setPermissionError("Failed to process the recording. Please try again.")
            setPhase(forImitation ? "playing-reversed" : "start")
          }

          setAnalyserNode(null)
          stream.getTracks().forEach((track) => track.stop())
        }

        mediaRecorder.start(100) // Collect data every 100ms for smoother recording
        setIsRecording(true)
        setPhase(forImitation ? "recording-imitation" : "recording-original")
      } catch (error) {
        const err = error as Error
        console.error("[v0] Error starting recording:", err)

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

      if (sourceNodeRef.current) {
        sourceNodeRef.current.stop()
      }

      const source = audioContext.createBufferSource()
      source.buffer = buffer

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyser.connect(audioContext.destination)
      setAnalyserNode(analyser)

      source.onended = () => {
        setIsPlaying(false)
        setAnalyserNode(null)
        if (onEnd) onEnd()
      }

      sourceNodeRef.current = source
      source.start()
      setIsPlaying(true)
    },
    [getAudioContext],
  )

  const playReversedAudio = useCallback(() => {
    if (reversedAudio) {
      setPhase("playing-reversed")
      playAudio(reversedAudio)
    }
  }, [reversedAudio, playAudio])

  const playImitationReversed = useCallback(() => {
    if (reversedImitationAudio) {
      playAudio(reversedImitationAudio)
    }
  }, [reversedImitationAudio, playAudio])

  const playOriginal = useCallback(() => {
    if (originalAudio) {
      playAudio(originalAudio)
    }
  }, [originalAudio, playAudio])

  const resetGame = useCallback(() => {
    setPhase("start")
    setOriginalAudio(null)
    setReversedAudio(null)
    setImitationAudio(null)
    setReversedImitationAudio(null)
    setIsRecording(false)
    setIsPlaying(false)
    setAnalyserNode(null)
    setPermissionError(null)
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-2xl">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2 tracking-tight">
            <span className="text-primary">Reverse</span> Sing
          </h1>
          <p className="text-muted-foreground text-lg">Can you speak backwards?</p>
        </header>

        <GamePhaseIndicator phase={phase} />

        <Card className="mt-6 border-2 border-border shadow-xl bg-card overflow-hidden">
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

            <AudioVisualizer analyser={analyserNode} isActive={isRecording || isPlaying} />

            <div className="mt-8 space-y-4">
              {phase === "start" && (
                <div className="text-center space-y-6">
                  <div className="bg-muted/50 rounded-xl p-6">
                    <h2 className="text-xl font-semibold mb-4 text-foreground">How to Play</h2>
                    <ol className="text-left text-muted-foreground space-y-3">
                      <li className="flex items-start gap-3">
                        <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                          1
                        </span>
                        <span>Player 1 records a phrase or sings something</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="bg-secondary text-secondary-foreground w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                          2
                        </span>
                        <span>Player 2 listens to it played in reverse</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="bg-accent text-accent-foreground w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                          3
                        </span>
                        <span>Player 2 tries to imitate the reversed audio</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="bg-success text-success-foreground w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                          4
                        </span>
                        <span>Hear the imitation played forward to reveal the result!</span>
                      </li>
                    </ol>
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
                      {micPermission === "granted" ? "Start Recording" : "Allow Microphone & Start"}
                    </Button>
                  )}
                </div>
              )}

              {phase === "requesting-permission" && (
                <div className="text-center space-y-4">
                  <div className="w-20 h-20 mx-auto bg-primary/20 rounded-full flex items-center justify-center">
                    <Mic className="h-10 w-10 text-primary animate-pulse" />
                  </div>
                  <p className="text-lg font-medium text-foreground">Requesting microphone access...</p>
                  <p className="text-sm text-muted-foreground">
                    Please allow microphone access when prompted by your browser
                  </p>
                </div>
              )}

              {phase === "recording-original" && (
                <div className="text-center space-y-4">
                  <div className="animate-pulse">
                    <div className="w-20 h-20 mx-auto bg-primary/20 rounded-full flex items-center justify-center">
                      <div className="w-14 h-14 bg-primary rounded-full flex items-center justify-center">
                        <Mic className="h-7 w-7 text-primary-foreground" />
                      </div>
                    </div>
                  </div>
                  <p className="text-lg font-medium text-foreground">Recording... Say or sing something!</p>
                  <p className="text-sm text-muted-foreground">Player 2 should look away!</p>
                  <Button size="lg" onClick={stopRecording} variant="destructive" className="px-8">
                    Stop Recording
                  </Button>
                </div>
              )}

              {phase === "original-recorded" && (
                <div className="text-center space-y-6">
                  <div className="bg-success/10 rounded-xl p-4 border border-success/30">
                    <p className="text-success font-medium flex items-center justify-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Original recorded! Pass to Player 2
                    </p>
                  </div>
                  <p className="text-muted-foreground">Player 2: Listen carefully to the reversed audio</p>
                  <Button size="lg" onClick={playReversedAudio} className="px-8" disabled={isPlaying}>
                    <Volume2 className="mr-2 h-5 w-5" />
                    Play Reversed Audio
                  </Button>
                </div>
              )}

              {phase === "playing-reversed" && (
                <div className="text-center space-y-6">
                  <div className="animate-pulse">
                    <div className="w-20 h-20 mx-auto bg-secondary/20 rounded-full flex items-center justify-center">
                      <div className="w-14 h-14 bg-secondary rounded-full flex items-center justify-center">
                        <Volume2 className="h-7 w-7 text-secondary-foreground" />
                      </div>
                    </div>
                  </div>
                  <p className="text-lg font-medium text-foreground">Playing reversed audio...</p>
                  <p className="text-sm text-muted-foreground">Listen carefully and try to remember it!</p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button size="lg" onClick={playReversedAudio} variant="outline" disabled={isPlaying}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Play Again
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
                  <div className="animate-pulse">
                    <div className="w-20 h-20 mx-auto bg-accent/20 rounded-full flex items-center justify-center">
                      <div className="w-14 h-14 bg-accent rounded-full flex items-center justify-center">
                        <Mic className="h-7 w-7 text-accent-foreground" />
                      </div>
                    </div>
                  </div>
                  <p className="text-lg font-medium text-foreground">Recording imitation...</p>
                  <p className="text-sm text-muted-foreground">Try to copy the reversed audio!</p>
                  <Button size="lg" onClick={stopRecording} variant="destructive" className="px-8">
                    Stop Recording
                  </Button>
                </div>
              )}

              {phase === "imitation-recorded" && (
                <div className="text-center space-y-6">
                  <div className="bg-accent/10 rounded-xl p-4 border border-accent/30">
                    <p className="text-accent-foreground font-medium flex items-center justify-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Imitation recorded! Ready for the reveal?
                    </p>
                  </div>
                  <Button size="lg" onClick={() => setPhase("reveal")} className="px-8">
                    <ArrowRight className="mr-2 h-5 w-5" />
                    See the Result
                  </Button>
                </div>
              )}

              {phase === "reveal" && (
                <div className="text-center space-y-6">
                  <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-secondary/10 rounded-xl p-6">
                    <h3 className="text-2xl font-bold text-foreground mb-2">The Reveal!</h3>
                    <p className="text-muted-foreground">Compare the original with the imitation played in reverse</p>
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
                      <span className="text-xs text-muted-foreground">What Player 1 said</span>
                    </Button>
                    <Button
                      size="lg"
                      onClick={playImitationReversed}
                      disabled={isPlaying}
                      className="flex flex-col h-auto py-4"
                    >
                      <Play className="h-6 w-6 mb-1" />
                      <span className="font-semibold">Imitation Reversed</span>
                      <span className="text-xs text-primary-foreground/70">Did Player 2 match it?</span>
                    </Button>
                  </div>

                  <Button size="lg" onClick={resetGame} variant="secondary" className="mt-4">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Play Again
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
