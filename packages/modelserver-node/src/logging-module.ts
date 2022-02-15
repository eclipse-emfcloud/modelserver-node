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

import { Logger } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { ContainerModule } from 'inversify';
import { EOL } from 'os';
import { createLogger, format, transports } from 'winston';

import { LogLevel } from './di';

const RootLogger = Symbol('RootLogger');

export default new ContainerModule(bind => {
    bind(RootLogger)
        .toDynamicValue(ctx => {
            const logLevel = ctx.container.get(LogLevel) as LogLevel;
            return createLogger({
                level: logLevel,
                format: format.combine(
                    format.timestamp({
                        format: 'YYYY-MM-DD HH:mm:ss.SSS'
                    }),
                    format.splat(),
                    format.colorize(),
                    format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label', 'service'] }),
                    format.printf(({ level, message, timestamp, service, metadata }) => {
                        let result = `[${timestamp} ${service}] ${level}: ${message}`;
                        if (metadata?.stack) {
                            result = `${result}${EOL}${metadata.stack}`;
                        }
                        return result;
                    })
                ),
                defaultMeta: { service: 'model-server' },
                transports: [new transports.Console()]
            });
        })
        .inSingletonScope();

    bind(Logger).toDynamicValue(ctx => {
        const root = ctx.container.get(RootLogger) as Logger;
        const loggerName = ctx.currentRequest.target.getNamedTag()?.value ?? 'anonymous';
        const result = root.child({});
        result.defaultMeta = { ...root.defaultMeta, service: loggerName };
        return result;
    });
});
