import { useState } from 'react';
import { createProposal, suggestDemoEdits, type EditProposal } from '@openvideomaker/agent';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';

/**
 * Agent panel: a lightweight command surface (not a chat). The LLM
 * editing agent will run in the desktop app; today the built-in
 * deterministic planner proposes edits over the CURRENT project and
 * the same proposal engine the agent will use drives preview / apply
 * (one undoable transaction) / reject.
 */
export function AgentPanel() {
  const controller = useStudio();
  const { t } = useI18n();
  const [proposals, setProposals] = useState<EditProposal[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [shortDuration, setShortDuration] = useState(30);

  const suggest = (): void => {
    setProposals(suggestDemoEdits(controller.project).map((s) => createProposal(controller.project, s.plan, s.script)));
    setPreviewId(null);
  };

  const aiPlan = async (): Promise<void> => {
    setPlanning(true);
    setPlanError(null);
    const result = await controller.planWithLlm(goal.trim());
    setPlanning(false);
    if (!result.ok) {
      setPlanError(result.message);
      return;
    }
    setProposals((list) => [...list, createProposal(controller.project, result.plan, result.script)]);
    setPreviewId(null);
    setGoal('');
  };

  const apply = (proposal: EditProposal): void => {
    const result = controller.applyAgentProposal(proposal);
    if (result.ok) setProposals((list) => [...list]);
  };

  return (
    <div className="agent-list">
      <p className="agent-hint">{t('agent.hint')}</p>
      {controller.llmPlannerAvailable ? (
        <div className="agent-ai">
          <input
            className="agent-goal-input"
            type="text"
            value={goal}
            placeholder={t('agent.ai.goal')}
            aria-label={t('agent.ai.goal')}
            disabled={planning}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && goal.trim() && !planning) void aiPlan();
            }}
          />
          <button type="button" className="button button-primary" disabled={planning || !goal.trim()} onClick={() => void aiPlan()}>
            {planning ? t('agent.ai.planning') : t('agent.ai.plan')}
          </button>
          {planError ? <p className="agent-errors">{planError}</p> : null}
        </div>
      ) : null}
      {controller.shortPlannerAvailable ? (
        <div className="agent-short">
          <span className="field-label">{t('agent.short.title')}</span>
          <select
            className="agent-short-duration"
            value={shortDuration}
            aria-label={t('agent.short.duration')}
            onChange={(e) => setShortDuration(Number(e.target.value))}
          >
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              const result = controller.createShortProposal(shortDuration * 1_000_000);
              if (result.ok) {
                setProposals((list) => [...list, createProposal(controller.project, result.plan, result.script)]);
                setPreviewId(null);
              } else {
                setPlanError(result.message);
              }
            }}
          >
            {t('agent.short.create')}
          </button>
        </div>
      ) : null}
      <button type="button" className="button button-primary" onClick={suggest}>
        {t('agent.suggest')}
      </button>
      {proposals.length === 0 ? (
        <div className="empty-panel">
          <p>{t('agent.empty')}</p>
        </div>
      ) : (
        proposals.map((proposal) => (
          <section key={proposal.id} className={'agent-card' + (proposal.state === 'applied' ? ' applied' : '')}>
            <header className="agent-head">
              <span className="agent-goal">{proposal.plan.goal}</span>
              <span className="agent-state">{t(proposal.state === 'applied' ? 'agent.applied' : 'agent.proposed')}</span>
            </header>
            <ul className="agent-changes">
              {proposal.plan.intendedChanges.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
            <p className="agent-outcome">{proposal.plan.expectedOutcome}</p>
            <div className="agent-actions">
              <button type="button" className="button" onClick={() => setPreviewId(previewId === proposal.id ? null : proposal.id)}>
                {t('agent.preview')}
              </button>
              <button type="button" className="button button-primary" disabled={!proposal.preview.ok || proposal.state === 'applied'} onClick={() => apply(proposal)}>
                {t('agent.apply')}
              </button>
              <button type="button" className="button button-ghost" onClick={() => setProposals((list) => list.filter((p) => p.id !== proposal.id))}>
                {t('agent.reject')}
              </button>
            </div>
            {previewId === proposal.id ? (
              <div className="agent-preview">
                <p>{t('agent.preview.operations')}: {proposal.preview.appliedTypes.join(', ') || '-'}</p>
                {proposal.preview.violations.length > 0 ? (
                  <p className="agent-errors">{t('agent.preview.violations')}: {proposal.preview.violations.map((v) => v.code).join(', ')}</p>
                ) : null}
                {proposal.preview.errors.length > 0 ? (
                  <p className="agent-errors">{proposal.preview.errors.join('; ')}</p>
                ) : null}
              </div>
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}
