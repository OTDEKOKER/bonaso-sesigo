export const toIsoDate = (value: Date = new Date()) => value.toISOString().slice(0, 10)

export const formatDate = (
  value: string | Date | null | undefined,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
) => {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(locale, options)
}
