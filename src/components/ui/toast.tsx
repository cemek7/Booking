"use client";
import React, { useEffect } from 'react';
let listeners: ((msg: ToastMessage) => void)[] = [];
export type ToastType = 'success' | 'error' | 'info';
export interface ToastMessage { type: ToastType; message: string; id?: number; }

export function toast(type: ToastType, message: string) {
	listeners.forEach(fn => fn({ type, message, id: Date.now() }));
}
toast.success = (msg: string) => toast('success', msg);
toast.error = (msg: string) => toast('error', msg);
toast.info = (msg: string) => toast('info', msg);

export function ToastContainer() {
	const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
	useEffect(() => {
		const fn = (msg: ToastMessage) => {
			setToasts(t => [...t, msg]);
			setTimeout(() => setToasts(t => t.filter(x => x.id !== msg.id)), 3000);
		};
		listeners.push(fn);
		return () => { listeners = listeners.filter(l => l !== fn); };
	}, []);
	return (
		<div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
			{toasts.map(t => (
				<div
					key={t.id}
					className={`px-4 py-2 rounded shadow text-white border border-white/6 ${t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}>
					{t.message}
				</div>
			))}
		</div>
	);
}
