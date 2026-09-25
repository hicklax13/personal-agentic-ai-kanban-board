import { useEffect, useState } from 'react';
import type { AppSettings, DiscoveryReport, JudgeSettings } from '@shared/types';
import AssigneeFields from './AssigneeFields.js';
import ScopeFields from './ScopeFields.js';

interface Props {
  settings: AppSettings;
  discovery: DiscoveryReport | null;
  onSave: (judge: JudgeSettings) => Promise<void>;
}

/**
 * Settings → Judge: who decides that a Goal-mode task is done.
 *
 * After every round of work the judge runs in the worker's folder with the
 * tools chosen here, checks the result against the card's title and
 * description, and answers done, continue (with what is missing) or blocked.
 */
export default function JudgePanel({ settings, discovery, onSave }: Props): React.JSX.Element {
  const [judge, setJudge] = useState<JudgeSettings>(settings.judge);
  const [rounds, setRounds] = useState(String(settings.judge.maxRounds));

  useEffect(() => {
    setJudge(settings.judge);
    setRounds(String(settings.judge.maxRounds));
  }, [settings.judge]);

  const save = (next: JudgeSettings): void => {
    setJudge(next);
    void onSave(next);
  };

  return (
    <>
      <div className="banner info">
        Goal mode keeps a task going until a judge agrees it is done. After each round of work the judge
        runs in the same folder, checks the result against the card&apos;s title and description, and answers
        <b> done</b> (the card moves to DONE), <b>continue</b> (its feedback goes back to the worker) or
        <b> blocked</b> (the task cannot be finished as written; the card moves to BLOCKED for you). It does
        not change files.
      </div>

      <AssigneeFields
        idPrefix="judge"
        label="Judge"
        noneLabel="— no judge (Goal mode cannot run) —"
        discovery={discovery}
        settings={settings}
        value={judge}
        onChange={(v) =>
          save(
            v.agentId !== judge.agentId
              ? { ...judge, ...v, allowedSkills: [], allowedMcpServers: [], allowedTools: [], allowedPlugins: [] }
              : { ...judge, ...v },
          )
        }
      />

      <div className="field">
        <label htmlFor="judge-rounds">Rounds before a person takes over</label>
        <input
          id="judge-rounds"
          type="number"
          min={1}
          max={50}
          value={rounds}
          style={{ width: 90 }}
          onChange={(e) => setRounds(e.target.value)}
          onBlur={() => {
            const n = Math.min(50, Math.max(1, Math.round(Number(rounds) || judge.maxRounds)));
            setRounds(String(n));
            if (n !== judge.maxRounds) save({ ...judge, maxRounds: n });
          }}
        />
        <div className="hint">
          Each round is a full run of the worker plus one check by the judge. If the judge is still not
          satisfied after this many, the card moves to BLOCKED with its last feedback.
        </div>
      </div>

      <div className="field">
        <label>What the judge may use (optional)</label>
        <ScopeFields
          discovery={discovery}
          agentId={judge.agentId}
          value={judge}
          onChange={(patch) => save({ ...judge, ...patch })}
        />
        <div className="hint">
          Tests, file listings and read-only MCP servers help the judge check real evidence instead of the
          worker&apos;s word.
        </div>
      </div>
    </>
  );
}
