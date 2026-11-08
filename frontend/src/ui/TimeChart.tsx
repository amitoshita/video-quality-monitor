import { useEffect, useLayoutEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface ChartSeries {
  label: string;
  /** CSS custom property holding the series colour, e.g. "--series-1". */
  colorVar: string;
  values: (number | null)[];
}

export interface ThresholdLine {
  value: number;
  label: string;
}

interface Props {
  title: string;
  x: number[];
  series: ChartSeries[];
  xRange: [number, number];
  yRange: [number, number];
  thresholds: ThresholdLine[];
  /** Charts with the same key share a crosshair. */
  syncKey: string;
  /** Reports the plot area (CSS px, relative to the chart) so strips can align to it. */
  onPlotBox?: (box: { left: number; width: number }) => void;
  height?: number;
  /** Show the "seconds" axis title (only the bottom chart of a stack needs it). */
  showXLabel?: boolean;
}

/** Fixed y-axis width so stacked charts (and the strips below) share the same plot area. */
export const Y_AXIS_SIZE = 48;

function cssVar(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

/**
 * A thin uPlot wrapper: created once, then updated in place with setData (no re-creation and no
 * animation on every second). Null values are drawn as gaps, never as zeros.
 */
export function TimeChart({
  title,
  x,
  series,
  xRange,
  yRange,
  thresholds,
  syncKey,
  onPlotBox,
  height = 160,
  showXLabel = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Read inside uPlot hooks, which are bound once at creation.
  const latest = useRef({ thresholds, xRange, onPlotBox });
  useLayoutEffect(() => {
    latest.current = { thresholds, xRange, onPlotBox };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ink = cssVar(container, "--text-secondary");
    const grid = cssVar(container, "--grid");
    const axis: uPlot.Axis = {
      stroke: ink,
      grid: { stroke: grid, width: 1 },
      ticks: { stroke: grid, width: 1 },
      font: "12px system-ui, sans-serif",
    };

    const plot = new uPlot(
      {
        width: container.clientWidth,
        height,
        scales: {
          x: { time: false, range: () => latest.current.xRange },
          // Grows if data exceeds the default (e.g. a 120 fps camera); never clips a value.
          y: { range: (_u, _min, max) => [yRange[0], Math.max(yRange[1], max)] },
        },
        axes: [
          showXLabel
            ? { ...axis, label: "seconds", labelSize: 18, labelFont: "12px system-ui" }
            : axis,
          { ...axis, size: Y_AXIS_SIZE },
        ],
        series: [
          { label: "t" },
          ...series.map((s) => ({
            label: s.label,
            stroke: cssVar(container, s.colorVar),
            width: 2,
            points: { show: false },
            spanGaps: false,
          })),
        ],
        cursor: { sync: { key: syncKey }, drag: { x: false, y: false } },
        legend: { live: true },
        hooks: {
          draw: [
            (u) => {
              // Dashed threshold lines, labelled at the right edge in muted ink.
              const { ctx, bbox } = u;
              ctx.save();
              ctx.textAlign = "right"; // uPlot leaves its own alignment set on the context
              ctx.textBaseline = "bottom";
              ctx.strokeStyle = ink;
              ctx.fillStyle = ink;
              ctx.setLineDash([4, 4]);
              ctx.lineWidth = devicePixelRatio;
              ctx.font = `${String(11 * devicePixelRatio)}px system-ui, sans-serif`;
              for (const line of latest.current.thresholds) {
                const y = Math.round(u.valToPos(line.value, "y", true));
                ctx.beginPath();
                ctx.moveTo(bbox.left, y);
                ctx.lineTo(bbox.left + bbox.width, y);
                ctx.stroke();
                ctx.fillText(
                  line.label,
                  bbox.left + bbox.width - 4 * devicePixelRatio,
                  y - 2 * devicePixelRatio,
                );
              }
              ctx.restore();
            },
          ],
          setSize: [
            (u) => {
              latest.current.onPlotBox?.({
                left: u.bbox.left / devicePixelRatio,
                width: u.bbox.width / devicePixelRatio,
              });
            },
          ],
        },
      },
      [x, ...series.map((s) => s.values)],
      container,
    );
    plotRef.current = plot;
    latest.current.onPlotBox?.({
      left: plot.bbox.left / devicePixelRatio,
      width: plot.bbox.width / devicePixelRatio,
    });

    const resize = new ResizeObserver(() => {
      plot.setSize({ width: container.clientWidth, height });
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Series layout, axes and height are fixed for the chart's lifetime; data updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    plotRef.current?.setData([x, ...series.map((s) => s.values)]);
  }, [x, series, xRange]);

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <div ref={containerRef} className="chart-canvas" />
    </figure>
  );
}
