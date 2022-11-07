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

import { CompletablePromise } from '../client/promise-utils';

describe('CompletablePromise', () => {
    it('#resolve', async () => {
        const promise = CompletablePromise.newPromise<string>();

        setTimeout(() => {
            promise.resolve('Hello, world!');
        }, 0);

        const message = await promise;
        expect(message).to.equal('Hello, world!');
    });

    it('#reject', async () => {
        const promise = CompletablePromise.newPromise<string>();

        setTimeout(() => {
            promise.reject(new Error('Bad data'));
        }, 0);

        try {
            await promise;
        } catch (e) {
            expect(e).to.be.instanceOf(Error);
            expect(e.message).to.be.equal('Bad data');
        }
    });

    it('#then', async () => {
        const promise = CompletablePromise.newPromise<{ x: string }>();
        const then = promise.then(value => value.x);

        setTimeout(() => {
            promise.resolve({ x: 'Hello, world!' });
        }, 0);

        const message = await then;
        expect(message).to.equal('Hello, world!');
    });

    it('#catch', async () => {
        const promise = CompletablePromise.newPromise<string>();
        const catch_ = promise.catch(e => e.toString());

        setTimeout(() => {
            promise.reject(new Error('Bad data'));
        }, 0);

        const message = await catch_;
        expect(message).to.be.equal('Error: Bad data');
    });
});
