import type { SelectHTMLAttributes } from "react";
import { COMMON_CURRENCIES, currencyName, OTHER_CURRENCIES } from "@/lib/currencies";

/**
 * Common currencies first, then every other one by name, each as "JPY — Japanese Yen".
 * With codeOnly, the closed box shows just the code ("JPY") to fit a narrow
 * space; the open list still has the names.
 */
export function CurrencySelect({
  notSetLabel,
  codeOnly,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { notSetLabel?: string; codeOnly?: boolean }) {
  const option = (code: string) => (
    <option key={code} value={code}>
      {code} — {currencyName(code)}
    </option>
  );
  const select = (
    <select {...props}>
      {notSetLabel && <option value="">{notSetLabel}</option>}
      <optgroup label="Common">{COMMON_CURRENCIES.map(option)}</optgroup>
      <optgroup label="All currencies">{OTHER_CURRENCIES.map(option)}</optgroup>
    </select>
  );
  if (!codeOnly) return select;
  // A select always shows its chosen option's text, so the code is laid over it
  // and the select's own text hidden.
  return (
    <span className="currency-code-only">
      {select}
      <span aria-hidden="true">{props.value ? String(props.value) : notSetLabel}</span>
    </span>
  );
}
