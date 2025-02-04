"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import type { LegendProps } from "recharts";
import { cn } from "@/lib/utils";
import type { ResponsiveContainerProps } from "recharts";

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  );
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps>({
  config: {},
});

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a ChartProvider");
  }
  return context;
}

interface ChartProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig;
  children: NonNullable<ResponsiveContainerProps["children"]>;
}

const ChartContainer = React.forwardRef<HTMLDivElement, ChartProps>(
  ({ className, config, children, ...props }, ref) => {
    const chartId = React.useId();

    return (
      <ChartContext.Provider value={{ config }}>
        <div
          data-chart={chartId}
          ref={ref}
          className={cn(
            "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
            className
          )}
          {...props}
        >
          <ChartStyle id={chartId} config={config} />
          <RechartsPrimitive.ResponsiveContainer>
            {children}
          </RechartsPrimitive.ResponsiveContainer>
        </div>
      </ChartContext.Provider>
    );
  }
);
ChartContainer.displayName = "ChartContainer";

interface ChartStyleProps {
  id: string;
  config: ChartConfig;
}

const ChartStyle = ({ id, config }: ChartStyleProps) => {
  const colorConfig = Object.entries(config).filter(
    ([_, config]) => config.theme || config.color
  );

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .filter(Boolean)
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  );
};

type PayloadData = {
  fill?: string;
  [key: string]: any;
};

type TooltipPayloadItem = {
  dataKey?: string;
  name?: string;
  value?: number | string;
  payload?: PayloadData;
  color?: string;
};

interface ChartTooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  labelKey?: string;
  labelFormatter?: (label: string) => React.ReactNode;
  hideLabel?: boolean;
  indicator?: "line" | "dot" | "dashed";
  hideIndicator?: boolean;
  color?: string;
  nameKey?: string;
  formatter?: (
    value: string | number,
    name: string,
    item: TooltipPayloadItem,
    index: number,
    payload: PayloadData
  ) => React.ReactNode;
}

const ChartTooltip = React.forwardRef<HTMLDivElement, ChartTooltipProps>(
  (
    {
      active,
      payload,
      label,
      labelKey,
      labelFormatter,
      hideLabel,
      indicator = "dot",
      hideIndicator = false,
      color,
      nameKey,
      formatter,
      className,
      ...props
    },
    ref
  ) => {
    const { config } = useChart();

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null;
      }

      const firstItem = payload[0];
      if (!firstItem) {
        return null;
      }

      const key = `${
        labelKey || firstItem.dataKey || firstItem.name || "value"
      }`;
      const itemConfig = getPayloadConfigFromPayload(config, firstItem, key);
      const value =
        !labelKey && typeof label === "string"
          ? config[label as keyof typeof config]?.label || label
          : itemConfig?.label;

      if (labelFormatter) {
        return labelFormatter(String(value));
      }

      return value;
    }, [config, hideLabel, label, labelFormatter, labelKey, payload]);

    if (!active || !payload?.length) {
      return null;
    }

    const nestLabel = payload.length === 1 && indicator !== "dot";

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
          className
        )}
        {...props}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload.map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor =
              color || item.payload?.["fill"] || item.color;

            return (
              <div
                key={item.dataKey}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center"
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(
                    item.value,
                    item.name,
                    item,
                    index,
                    item.payload || {}
                  )
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]",
                            {
                              "h-2.5 w-2.5": indicator === "dot",
                              "w-1": indicator === "line",
                              "w-0 border-[1.5px] border-dashed bg-transparent":
                                indicator === "dashed",
                              "my-0.5": nestLabel && indicator === "dashed",
                            }
                          )}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center"
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">
                          {itemConfig?.label || item.name}
                        </span>
                      </div>
                      {item.value && (
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {item.value.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
ChartTooltip.displayName = "ChartTooltip";

interface ChartLegendContentProps extends React.HTMLAttributes<HTMLDivElement> {
  payload?: LegendProps["payload"];
  verticalAlign?: "top" | "bottom";
  hideIcon?: boolean;
  nameKey?: string;
}

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  ChartLegendContentProps
>(
  (
    { className, hideIcon = false, payload, verticalAlign = "bottom", nameKey },
    ref
  ) => {
    const { config } = useChart();

    if (!payload?.length) {
      return null;
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center justify-center gap-4",
          verticalAlign === "top" ? "pb-3" : "pt-3",
          className
        )}
      >
        {payload.map((item) => {
          const key = `${nameKey || item.dataKey || "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div
              key={item.value}
              className={cn(
                "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              {itemConfig?.label}
            </div>
          );
        })}
      </div>
    );
  }
);
ChartLegendContent.displayName = "ChartLegendContent";

interface PayloadObject {
  dataKey?: string;
  name?: string;
  [key: string]: unknown;
}

function isPayloadObject(payload: unknown): payload is PayloadObject {
  return typeof payload === "object" && payload !== null;
}

function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
): ChartConfig[keyof ChartConfig] | undefined {
  if (!isPayloadObject(payload)) {
    return undefined;
  }

  // Try to get config using the provided key first
  if (key in config) {
    return config[key];
  }

  // Try dataKey if available
  if (
    payload.dataKey &&
    typeof payload.dataKey === "string" &&
    payload.dataKey in config
  ) {
    return config[payload.dataKey];
  }

  // Try name if available
  if (
    payload.name &&
    typeof payload.name === "string" &&
    payload.name in config
  ) {
    return config[payload.name];
  }

  return undefined;
}

const ChartLegend = RechartsPrimitive.Legend;

export {
  ChartContainer,
  ChartTooltip,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  useChart,
};
