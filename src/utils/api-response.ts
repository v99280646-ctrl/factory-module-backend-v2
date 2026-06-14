import type { Response } from "express";

export function ok<T>(res: Response, data: T, message?: string) {
  return res.json({ success: true, data, message });
}

export function fail(res: Response, status: number, message: string) {
  return res.status(status).json({ success: false, data: null, message });
}
