import { describe, expect, it } from 'vitest';
import { ProjectSession } from '@openvideomaker/core';
import { StudioController } from '../src/studio/controller';

describe('StudioController desktop hooks', () => {
  it('loads a project snapshot + log in place, resetting session state', () => {
    const controller = StudioController.welcome();
    const session = ProjectSession.create('Loaded project', { settings: { width: 640, height: 360 } });
    session.transaction((tx) => tx.renameProject({ name: 'Renamed project' }));
    const result = controller.loadProject(session.project, session.exportLog());
    expect(result.ok).toBe(true);
    expect(controller.project.name).toBe('Renamed project');
    expect(controller.project.settings.width).toBe(640);
    expect(controller.playheadUs).toBe(0);
    expect(controller.selectedClipId).toBeNull();
  });

  it('reports browser capabilities honestly without a desktop bridge', () => {
    const controller = StudioController.welcome();
    expect(controller.capabilities).toEqual({ localRender: false, localGeneration: false, localPersistence: false });
  });
});
