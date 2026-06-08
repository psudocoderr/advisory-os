import { format } from "date-fns";

export function inr(value: number | string) {
  const amount = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
}

export function compactInr(value: number | string) {
  const amount = Number(value);
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  return inr(amount);
}

export function dateLabel(value: Date | string) {
  return format(new Date(value), "d MMM yyyy");
}

export function maskPan(pan: string) {
  if (pan.length < 4) return "••••";
  return `${pan.slice(0, 2)}XXXXXX${pan.slice(-2)}`;
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `${digits.slice(0, 2)}XXXXXX${digits.slice(-2)}`;
}

export function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
