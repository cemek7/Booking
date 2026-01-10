import { useState } from "react";

export default function WhatsAppQRCodeSection({ qrCodeUrl, onRefresh, status }: { qrCodeUrl?: string; onRefresh?: () => void; status?: string }) {
  return (
    <div className="mb-6 p-4 border rounded bg-white">
      <h2 className="text-lg font-semibold mb-2">WhatsApp QR Code Linking</h2>
      <p className="mb-2 text-gray-600">Scan this QR code with your WhatsApp Business app to link your tenant's WhatsApp number for chat onboarding.</p>
      {qrCodeUrl ? (
        <div className="flex flex-col items-center">
          <img src={qrCodeUrl} alt="WhatsApp QR Code" className="w-48 h-48 border mb-2" />
          <button onClick={onRefresh} className="text-blue-600 underline text-sm">Refresh QR Code</button>
        </div>
      ) : (
        <div className="text-gray-500">QR code not available. Please configure your WhatsApp provider and save settings.</div>
      )}
      {status && <div className="mt-2 text-sm text-gray-700">Status: {status}</div>}
    </div>
  );
}
