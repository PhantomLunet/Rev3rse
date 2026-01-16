"use client"

import { cn } from "@/lib/utils"
import { Mic, Volume2, RefreshCw, Sparkles } from "lucide-react"

type GamePhase =
  | "start"
  | "requesting-permission" // Added new phase
  | "recording-original"
  | "original-recorded"
  | "playing-reversed"
  | "recording-imitation"
  | "imitation-recorded"
  | "reveal"

interface GamePhaseIndicatorProps {
  phase: GamePhase
}

const phases = [
  { id: "record", label: "Record", icon: Mic },
  { id: "listen", label: "Listen", icon: Volume2 },
  { id: "imitate", label: "Imitate", icon: RefreshCw },
  { id: "reveal", label: "Reveal", icon: Sparkles },
]

function getPhaseIndex(phase: GamePhase): number {
  switch (phase) {
    case "start":
    case "requesting-permission": // Include new phase in record step
    case "recording-original":
    case "original-recorded":
      return 0
    case "playing-reversed":
      return 1
    case "recording-imitation":
    case "imitation-recorded":
      return 2
    case "reveal":
      return 3
    default:
      return 0
  }
}

export function GamePhaseIndicator({ phase }: GamePhaseIndicatorProps) {
  const currentIndex = getPhaseIndex(phase)

  return (
    <div className="flex items-center justify-between">
      {phases.map((p, index) => {
        const Icon = p.icon
        const isActive = index === currentIndex
        const isCompleted = index < currentIndex

        return (
          <div key={p.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all duration-300",
                  isActive && "bg-primary text-primary-foreground scale-110 shadow-lg",
                  isCompleted && "bg-success text-success-foreground",
                  !isActive && !isCompleted && "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4 md:h-5 md:w-5" />
              </div>
              <span
                className={cn(
                  "mt-2 text-xs md:text-sm font-medium transition-colors",
                  isActive && "text-primary",
                  isCompleted && "text-success",
                  !isActive && !isCompleted && "text-muted-foreground",
                )}
              >
                {p.label}
              </span>
            </div>
            {index < phases.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-1 mx-2 rounded-full transition-colors",
                  index < currentIndex ? "bg-success" : "bg-muted",
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
