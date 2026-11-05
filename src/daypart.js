/** Lighting for the task surfaces, from the device clock. */
export function daypart(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 16) return "midday";
  if (hour >= 16 && hour < 20) return "evening";
  return "night";
}
