import { makeD1 } from '../infrastructure/d1';
import { makeD1FaviconAssetRepository, makeFaviconAssetStore } from './assets';
import { faviconDarknessEnabled } from './darkness';
import { makeFaviconJobRepository } from './job-repository';
import { makeFaviconOrchestrator } from './orchestration';
import { makeFaviconRepository } from './repository';
import { makeFaviconService } from './service';

export const makeFaviconRuntime = (
    env: Env,
    options: { readonly now?: () => number } = {},
) => {
    if (!faviconDarknessEnabled(env))
        throw new Error('Queued favicon refresh requires IMAGES_ENABLED=true');

    const d1 = makeD1(env.DB);
    const assets = makeD1FaviconAssetRepository(d1);
    const service = makeFaviconService({
        repository: makeFaviconRepository(d1),
        assetStore: makeFaviconAssetStore({
            repository: assets,
            images: env.IMAGES,
        }),
        ...(options.now === undefined ? {} : { now: options.now }),
    });
    const orchestrator = makeFaviconOrchestrator({
        repository: makeFaviconJobRepository(d1),
        queue: {
            send: async (message) => {
                await env.FAVICON_REFRESH_QUEUE.send(message, {
                    contentType: 'json',
                });
            },
        },
        processor: service,
        ...(options.now === undefined ? {} : { now: options.now }),
    });
    return { assets, orchestrator };
};
