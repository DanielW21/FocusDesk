export interface IScrapedPieChart {
  chart: { type: string };
  title: { text: string };
  series: [{ data: Array<{ name: string; y: number }> }, ...Array<{ data: Array<{ name: string; y: number }> }>];
}

export interface IScrapedBarChart {
  chart: { type: string };
  title: { text: string };
  xAxis: { categories: string[] };
  series: [{ data: number[] }, ...Array<{ data: number[] }>];
}
