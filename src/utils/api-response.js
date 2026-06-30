export function ok(res, data, message) {
    return res.json({ success: true, data, message });
}
export function fail(res, status, message) {
    return res.status(status).json({ success: false, data: null, message });
}
