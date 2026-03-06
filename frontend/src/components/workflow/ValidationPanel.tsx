import { AlertTriangle, XCircle, CheckCircle } from 'lucide-react';
import type { ValidationResult } from '../../types/workflow';

interface ValidationPanelProps {
  result: ValidationResult;
  onClose: () => void;
}

export function ValidationPanel({ result, onClose }: ValidationPanelProps) {
  return (
    <div className={`border rounded-xl p-4 mb-4 ${
      result.valid ? 'bg-claw-success/5 border-claw-success/20' : 'bg-claw-danger/5 border-claw-danger/20'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {result.valid ? (
            <CheckCircle size={16} className="text-claw-success" />
          ) : (
            <XCircle size={16} className="text-claw-danger" />
          )}
          <span className={`text-sm font-semibold ${result.valid ? 'text-claw-success' : 'text-claw-danger'}`}>
            {result.valid ? '校验通过' : `发现 ${result.errors.length} 个错误`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-claw-muted hover:text-claw-text text-xs cursor-pointer"
        >
          关闭
        </button>
      </div>

      {result.errors.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {result.errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <XCircle size={12} className="text-claw-danger mt-0.5 shrink-0" />
              <div>
                <span className="text-claw-text">{err.message}</span>
                {err.nodeId && (
                  <span className="text-claw-muted ml-1 font-mono">({err.nodeId})</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {result.warnings.map((warn, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <AlertTriangle size={12} className="text-claw-warning mt-0.5 shrink-0" />
              <div>
                <span className="text-claw-text">{warn.message}</span>
                {warn.nodeId && (
                  <span className="text-claw-muted ml-1 font-mono">({warn.nodeId})</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
