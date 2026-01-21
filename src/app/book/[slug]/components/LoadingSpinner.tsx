export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full opacity-75 animate-pulse"></div>
            <div className="absolute inset-1 bg-white rounded-full"></div>
          </div>
        </div>
        <p className="text-slate-600 font-medium">Loading...</p>
      </div>
    </div>
  );
}
