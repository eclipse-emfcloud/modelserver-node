/********************************************************************************
 * Copyright (c) 2022 STMicroelectronics.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0, or the MIT License which is
 * available at https://opensource.org/licenses/MIT.
 *
 * SPDX-License-Identifier: EPL-2.0 OR MIT
 *******************************************************************************/

import { createContainer, LogLevel, ModelServer } from '@eclipse-emfcloud/modelserver-node';
import { ContainerModule } from 'inversify';
import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

(async () => {
    const args = await yargs(hideBin(process.argv))
        .option('port', {
            alias: 'p',
            type: 'number',
            default: 8082,
            description: 'Port on which to listen for or send requests'
        })
        .option('upstream', {
            alias: 'u',
            type: 'number',
            description: 'Port on which to connect to the Upstream Model Server'
        })
        .option('verbose', {
            alias: 'v',
            boolean: true,
            description: 'Whether to log verbose debug messages'
        })
        .version('0.1.0')
        .help()
        .strict().argv;

    const port = args.port;
    const upstream = args['upstream'];
    const verbosity: LogLevel = args.verbose ? 'debug' : 'info';

    const modules = await loadModules();
    const server = await createContainer(upstream, verbosity).then(container => {
        container.load(...modules);
        return container.get(ModelServer);
    });

    server.serve(port, upstream);
})();

async function loadModules(): Promise<ContainerModule[]> {
    const modules = [
        require('@eclipse-emfcloud/coffee-custom-commands-example/lib/example-commands-module'),
        require('@eclipse-emfcloud/coffee-custom-validators-example/lib/example-validators-module'),
        require('@eclipse-emfcloud/coffee-triggers-example/lib/example-triggers-module'),
        require('@eclipse-emfcloud/coffee-custom-routes-example/lib/example-routes-module'),
        require('@eclipse-emfcloud/coffee-custom-middleware-example/lib/example-middleware-module')
    ];

    const result = modules.map(module => module.default);
    return Promise.resolve(result);
}
