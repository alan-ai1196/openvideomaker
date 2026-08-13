import type { Project } from '@openvideomaker/schema';
import { OperationError } from '../errors.js';
import type { ApplyContext, ApplyFn } from '../types.js';
import type { ProjectCreateParams, ProjectRenameParams, ProjectSettingsParams } from '@openvideomaker/schema';

function isBlank(project: Project): boolean {
  return (
    project.name === '' &&
    Object.keys(project.sequences).length === 0 &&
    Object.keys(project.assets).length === 0 &&
    Object.keys(project.characters).length === 0
  );
}

export const applyProjectCreate: ApplyFn<ProjectCreateParams> = (project, params, ctx) => {
  if (!isBlank(project)) {
    throw new OperationError('op.immutable', 'project is already initialized');
  }
  if (project.id !== params.projectId) {
    throw new OperationError('op.validation', 'project.create projectId does not match the blank project id');
  }
  project.name = params.name;
  project.settings = { ...project.settings, ...(params.settings ?? {}) };
  project.createdAt = ctx.now;
  project.updatedAt = ctx.now;
};

export const applyProjectRename: ApplyFn<ProjectRenameParams> = (project, params, ctx) => {
  project.name = params.name;
  project.updatedAt = ctx.now;
};

export const applyProjectSettings: ApplyFn<ProjectSettingsParams> = (project, params, ctx) => {
  project.settings = { ...project.settings, ...params.settings };
  project.updatedAt = ctx.now;
};