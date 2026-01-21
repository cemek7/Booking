import LoadingSpinner from './LoadingSpinner';

export default function BookingPageSkeleton() {
  return (
    <div className="space-y-8">
      {/* Progress Indicator Skeleton */}
      <div className="flex items-center justify-between">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center">
            <div className="h-10 w-10 rounded-full bg-slate-200 animate-pulse"></div>
            {i < 4 && <div className="mx-2 h-1 w-8 md:w-12 bg-slate-200 animate-pulse"></div>}
          </div>
        ))}
      </div>

      {/* Header Skeleton */}
      <div className="bg-white rounded-lg p-6 shadow-sm space-y-4 animate-pulse">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-lg bg-slate-200"></div>
          <div className="flex-1 space-y-2">
            <div className="h-8 bg-slate-200 rounded w-1/2"></div>
            <div className="h-4 bg-slate-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>

      {/* Content Skeleton */}
      <div className="bg-white rounded-lg p-6 shadow-sm space-y-4 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-1/3"></div>
        <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        <div className="space-y-3 mt-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-slate-200 rounded"></div>
          ))}
        </div>
      </div>
    </div>
  );
}
