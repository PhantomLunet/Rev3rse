"use client"

import { useEffect, useRef } from "react"

interface AudioVisualizerProps {
  analyser: AnalyserNode | null
  isActive: boolean
}

export function AudioVisualizer({ analyser, isActive }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = rect.height * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height

      ctx.clearRect(0, 0, width, height)

      if (analyser && isActive) {
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyser.getByteFrequencyData(dataArray)

        const barWidth = (width / bufferLength) * 2.5
        let x = 0

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height * 0.8

          const hue = (i / bufferLength) * 60 + 320
          ctx.fillStyle = `oklch(0.7 0.2 ${hue})`

          const y = (height - barHeight) / 2
          ctx.beginPath()
          ctx.roundRect(x, y, barWidth - 2, barHeight, 4)
          ctx.fill()

          x += barWidth
        }
      } else {
        const bars = 40
        const barWidth = width / bars

        for (let i = 0; i < bars; i++) {
          const baseHeight = Math.sin((i / bars) * Math.PI) * 20 + 10
          const y = (height - baseHeight) / 2

          ctx.fillStyle = `oklch(0.7 0.1 280 / 0.3)`
          ctx.beginPath()
          ctx.roundRect(i * barWidth + 2, y, barWidth - 4, baseHeight, 4)
          ctx.fill()
        }
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [analyser, isActive])

  return (
    <div className="w-full h-32 md:h-40 bg-muted/30 rounded-xl overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: "block" }} />
    </div>
  )
}
