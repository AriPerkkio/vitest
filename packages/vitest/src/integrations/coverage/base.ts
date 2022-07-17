import { ExistingRawSourceMap, TransformPluginContext } from 'rollup';

import { UserConfig } from '../../config';
import { Vitest } from '../../node'
import { ResolvedCoverageOptions } from '../../types';

export interface BaseCoverageReporter {
    resolveOptions(): ResolvedCoverageOptions

    initialize(ctx: Vitest): Promise<void> | void;

    processUserConfig(userConfig: UserConfig): void;

    isEnabled(): boolean;

    instrument?(
        sourceCode: string,
        id: string,
        pluginCtx: TransformPluginContext
    ): { code: string, map: ExistingRawSourceMap};

    clean(): Promise<void> | void;

    report(): Promise<void> | void;
}
