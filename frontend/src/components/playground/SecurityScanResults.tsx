import { ShieldCheck, ShieldAlert, AlertTriangle, Info } from 'lucide-react';
import type { SecurityScanResult } from '../../types/playground';

interface SecurityScanResultsProps {
  result: SecurityScanResult;
}

const severityConfig = {
  critical: { icon: ShieldAlert, color: 'text-claw-danger', bg: 'bg-claw-danger/10', label: 'Critical' },
  warning: { icon: AlertTriangle, color: 'text-claw-warning', bg: 'bg-claw-warning/10', label: 'Warning' },
  info: { icon: Info, color: 'text-claw-info', bg: 'bg-claw-info/10', label: 'Info' },
} as const;

export function SecurityScanResults({ result }: SecurityScanResultsProps) {
  if (result.findings.length === 0) {
    return (
      <div className="px-4 py-2 border-t border-claw-border flex items-center gap-2 text-xs text-claw-success">
        <ShieldCheck size={14} />
        Security scan passed — no issues found
      </div>
    );
  }

  const criticalCount = result.findings.filter((f) => f.severity === 'critical').length;
  const warningCount = result.findings.filter((f) => f.severity === 'warning').length;

  return (
    <div className="border-t border-claw-border max-h-48 overflow-y-auto">
      <div className={`px-4 py-2 flex items-center gap-3 text-xs font-medium ${result.passed ? 'text-claw-warning' : 'text-claw-danger'}`}>
        {result.passed ? <AlertTriangle size={14} /> : <ShieldAlert size={14} />}
        {result.passed ? 'Scan passed with warnings' : 'Scan failed'}
        {criticalCount > 0 && <span className="text-claw-danger">{criticalCount} critical</span>}
        {warningCount > 0 && <span className="text-claw-warning">{warningCount} warnings</span>}
      </div>

      <div className="px-4 pb-2 space-y-1">
        {result.findings.map((finding, i) => {
          const cfg = severityConfig[finding.severity];
          const Icon = cfg.icon;
          return (
            <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs ${cfg.bg}`}>
              <Icon size={13} className={`${cfg.color} mt-0.5 shrink-0`} />
              <div>
                <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                <span className="text-claw-text ml-1">{finding.message}</span>
                {finding.line && <span className="text-claw-muted ml-1">(line {finding.line})</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
