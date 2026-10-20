"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"
import { cn } from "cn"

export interface ChartConfig {
  [key: string]: {
    label?: React.ReactNode
    color?: string
    icon?: React.ComponentType
  }
}

interface ChartContextValue {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextValue | null>(null)

function useChart(): ChartContextValue {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }
  return context
}

/**
 * A chart with a fixed aspect ratio and the colours the app uses. The series
 * are named in the config, so the legend and the tooltip read the same.
 */
function ChartContainer({
  config,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ReactElement
}) {
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        className={cn("flex aspect-video justify-center text-xs", className)}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel,
  labelFormatter,
  formatter,
}: {
  active?: boolean
  payload?: ReadonlyArray<Record<string, unknown>>
  label?: React.ReactNode
  className?: string
  hideLabel?: boolean
  labelFormatter?: (value: unknown) => React.ReactNode
  formatter?: (value: unknown, name: unknown) => React.ReactNode
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null

  return (
    <div
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-xl",
        className,
      )}
    >
      {!hideLabel && label !== undefined && (
        <div className="font-medium">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index)
          const entry = config[key]
          const value = formatter
            ? formatter(item.value, item.name)
            : (item.value as React.ReactNode)
          return (
            <div key={key} className="flex w-full items-center gap-2">
              <div
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: entry?.color }}
              />
              <span className="text-muted-foreground">{entry?.label ?? key}</span>
              <span className="ml-auto font-mono font-medium tabular-nums">{value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  payload,
  className,
}: {
  payload?: ReadonlyArray<Record<string, unknown>>
  className?: string
}) {
  const { config } = useChart()
  if (!payload?.length) return null

  return (
    <div className={cn("flex items-center justify-center gap-4", className)}>
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? item.value ?? index)
        const entry = config[key]
        return (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: entry?.color }}
            />
            <span className="text-muted-foreground">{entry?.label ?? key}</span>
          </div>
        )
      })}
    </div>
  )
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent }
