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
import { expect } from 'chai';

import { defer } from './promise-utils';

describe('Deferred', () => {
    it('#resolve', async () => {
        const deferred = defer<string>();

        setTimeout(() => {
            deferred.resolve('Hello, world!');
        }, 0);

        const message = await deferred.promise();
        expect(message).to.equal('Hello, world!');
    });

    it('#reject', async () => {
        const deferred = defer<string>();

        setTimeout(() => {
            deferred.reject(new Error('Bad data'));
        }, 0);

        try {
            await deferred.promise();
        } catch (e) {
            expect(e).to.be.instanceOf(Error);
            expect(e.message).to.be.equal('Bad data');
        }
    });
});
