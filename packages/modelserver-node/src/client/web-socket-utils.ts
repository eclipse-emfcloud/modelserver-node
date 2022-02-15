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
import { AnyObject, encode, ModelServerMessage, TypeGuard } from '@eclipse-emfcloud/modelserver-client';
import { Request } from 'express';
import { Logger } from 'winston';
import * as WebSocket from 'ws';

import { Disposable } from './disposable';

export type MessageHandler<T> = (msg: ModelServerMessage<T>) => boolean;
export type CloseHandler = (code: number, reason?: string | Buffer) => void;
export type ErrorHandler = (error: Error) => void;

export type WSUpgradeRequest = Request & {
    ws: WebSocket;
    upgrade: boolean;
};

export namespace WSUpgradeRequest {
    /** Query whether an incoming request is a websocket upgrade request. */
    export function is(req: Request): req is WSUpgradeRequest {
        return req.method === 'GET' && 'ws' in req && 'upgrade' in req && typeof req['upgrade'] === 'boolean' && req['upgrade'];
    }

    /** Get the original URL of a websocket upgrade request, without the `.websocket` segment. */
    export function getOriginalURL(req: WSUpgradeRequest): string {
        const result = req.url.replace(/\/.websocket(?=\?|$)/, '');
        return req.baseUrl ? req.baseUrl + result : result;
    }

    /** Change an `http:` URL to a `ws:` URL. */
    export function toWebsocketURL(httpURL: string): string {
        return httpURL.replace(/^[^:]+/, 'ws');
    }
}

/**
 * An utility that waits for a message on a given web socket.
 */
export class WebSocketMessageAcceptor<T = AnyObject> {
    private cleanup?: Disposable;

    /**
     * Initializes me.
     *
     * @param socket the socket on which to listen for a message
     * @param callback a callback accepting a message. If it returns `true`, then the message is matched
     *    and the acceptor ceasing listening for messages. If it returns `false`, then the acceptor continues
     *    listening for another message
     * @param closeHandler an optional call-back to handle the case of the socket being closed before the expected
     *    message was received
     */
    constructor(
        protected readonly ws: WebSocket,
        protected readonly callback: MessageHandler<T>,
        protected readonly closeHandler?: CloseHandler
    ) {
        const socket = new JSONSocket(ws);
        this.cleanup = Disposable.all(
            socket.onMessage(this.handleMessage.bind(this)), //
            socket.onClose(this.handleClose.bind(this))
        );
    }

    /**
     * Stop listening to the socket. The socket is _not_ closed.
     */
    close(): void {
        this.cleanup = Disposable.dispose(this.cleanup);
    }

    /**
     * Handle an incoming message, filtering it through our call-back to close if it is the expected message.
     *
     * @param event the incoming message event
     */
    protected handleMessage(event: ModelServerMessage<T>): void {
        if (this.callback(event)) {
            this.close();
        }
    }

    /**
     * Handle closure of the socket. Invoke the registered handler, if any, and then clean up.
     *
     * @param event the socket close event
     */
    protected handleClose(code: number, reason: string): void {
        if (this.closeHandler) {
            this.closeHandler(code, reason);
        }
        this.close();
    }

    /**
     * Convenience for creating a typed message acceptor.
     *
     * @param socket the socket on which to wait for incoming messages
     * @param parser a function that coerces, if possible, a message payload to the expected type
     * @param acceptor a call-back to accept the parsed message of the expected type
     * @param closeHandler an optional call-back to handle the case of the socket being closed before the expected
     *    message was received
     * @returns the web socket message acceptor
     */
    static accept<U>(
        socket: WebSocket,
        parser: (object: ModelServerMessage) => U,
        acceptor: (message: U) => void,
        closeHandler?: CloseHandler
    ): WebSocketMessageAcceptor {
        const callback: (event: ModelServerMessage) => boolean = event => {
            const accepted: U = event ? parser(toModelServerMessage(event)) : undefined;
            if (accepted) {
                acceptor(accepted);
                return true;
            }

            return false;
        };

        return new WebSocketMessageAcceptor(socket, callback, closeHandler);
    }

    /**
     * Convenience for creating a promise that will be resolved when a message of the expected
     * type is received. If the socket is closed before that, then the promise is rejected.
     *
     * @param socket the socket on which to wait for incoming messages
     * @param predicate a test whether a message payload is of the expected type
     * @returns a promise of the expected message type
     */
    static promise<U>(socket: WebSocket, predicate: (object: ModelServerMessage<U>) => boolean): Promise<U> {
        return new Promise<U>((resolve, reject) => {
            const parser: (message: ModelServerMessage<U>) => U = message => (predicate(message) ? message.data : undefined);

            WebSocketMessageAcceptor.accept(socket, parser, resolve, () => reject('Socket closed'));
        });
    }
}

function toModelServerMessage<T>(o: any): ModelServerMessage<T> | undefined {
    if (ModelServerMessage.is(o)) {
        // Convert $type to eClass for now
        // TODO: API with correct $type property
        return encode('json')(o) as ModelServerMessage<T>;
    }

    return undefined;
}

/**
 * Encapsulation of a `WebSocket` that constrains the messaging protocol
 * to the `ModelServerMessage` API.
 */
export class JSONSocket {
    constructor(protected readonly ws: WebSocket) {}

    /** Register an error handler. */
    onError(handler: (error: Error) => void): Disposable {
        const listener = (error: Error): void => handler.apply(this, [error]);
        this.ws.on('error', listener);
        return () => this.ws.off('error', listener);
    }

    /** Register a close handler. */
    onClose(handler: (code: number, reason: string) => void): Disposable {
        const listener = (code: number, reason: Buffer): void => handler.apply(this, [code, reason?.toString()]);
        this.ws.on('close', listener);
        return () => this.ws.off('close', listener);
    }

    /**
     * Register an message handler with an optional guard to filter for messages of a specific type/shape.
     *
     * @param handler the message handler
     * @param typeGuard an optional message type guard. Only messages that satisfy the guard are passed to the `handler`
     */
    onMessage<T extends AnyObject>(
        handler: (msg: ModelServerMessage<T>) => void,
        typeGuard?: TypeGuard<ModelServerMessage<T>>
    ): Disposable {
        const guard = typeGuard || ModelServerMessage.is;

        const listener = (data: WebSocket.RawData, isBinary: boolean): void => {
            if (isBinary) {
                // Binary messaging is not supported by the Model Server
                return;
            }

            const msg = this.parse(data, guard);
            if (msg) {
                handler.apply(this, [msg as ModelServerMessage<T>]);
            }
        };

        this.ws.on('message', listener);
        return () => this.ws.off('message', listener);
    }

    protected parse<T>(data: any, typeGuard: TypeGuard<ModelServerMessage<T>>): ModelServerMessage<T> | undefined {
        const object = typeof data === 'string' ? JSON.parse(data) : Buffer.isBuffer(data) ? JSON.parse(data.toString()) : undefined;
        return object && typeGuard(object) ? object : undefined;
    }

    /**
     * Send a message.
     *
     * @param msg the message to send
     * @param [cb] a call-back to be notified when send completes (or fails)
     */
    send(msg: ModelServerMessage<AnyObject>, cb?: (error?: Error) => void): void {
        this.ws.send(JSON.stringify(msg), cb);
    }

    /**
     * Query whether the socket is open.
     */
    get isOpen(): boolean {
        return this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Close the socket.
     *
     * @param code an optional code to send
     * @param reason an reason for the closure
     */
    close(code = 1000, reason = 'OK'): void {
        this.ws.close(code, reason);
    }
}

/**
 * Create a handler for closing of a socket connection that propagates the closure appropriately
 * to other connections.
 *
 * @param which indication of which of a set of coördinated socket connects this handler handles
 * @param logger a logger on which to write messages
 * @param others the other socket connections to close when the handled socket closes
 *
 * @returns the close handler
 */
export function handleClose(which: string, logger: Logger, ...others: (JSONSocket | WebSocket)[]): CloseHandler {
    return (code: number, reason?: string | Buffer) => {
        // Handle some standard close codes
        let propagate = code;
        let message: string;
        switch (code) {
            case 1005: {
                propagate = 1002;
                message = `${which} connection closed without any status code.`;
                logger.warn('%s: %s', message, reason);
                break;
            }
            case 1006: {
                propagate = 1001;
                message = `${which} connection closed abnormally.`;
                logger.warn('%s: %s', message, reason);
                break;
            }
            default: {
                // Sometimes the reason is a Buffer, not a string
                message = reason?.toString();
                logger.debug(`${which} connection closed with code ${code}: ${reason}`);
                break;
            }
        }

        // Don't need to close the handled socket because we're reacting to its close event
        others.filter(isOpen).forEach(ws => ws.close(propagate, message));
    };
}

/**
 * Create a handler for errors on a socket connection that closes the errored connection and
 * also propagates the error to other connections by closing them.
 *
 * @param which indication of which of a set of coördinated socket connects this handler handles
 * @param logger a logger on which to write messages
 * @param others the other socket connections to close when the handled socket errors
 *
 * @returns the close handler
 */
export function handleError(which: string, logger: Logger, ...others: (JSONSocket | WebSocket)[]): ErrorHandler {
    /** @this */
    return function (this: JSONSocket | WebSocket, error: Error): void {
        logger.error(`Error on ${which} socket.`, error);
        const message = error.message ?? 'An unknown error occurred.';
        this.close(1002, message);
        others.filter(isOpen).forEach(ws => ws.close(1002, message));
    };
}

function isOpen(socket: JSONSocket | WebSocket): boolean {
    if (socket instanceof JSONSocket) {
        return socket.isOpen;
    }
    return socket.readyState === WebSocket.OPEN;
}
