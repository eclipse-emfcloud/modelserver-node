# Model Server Server Framework

This package provides the _Model Server_ server framework.

## Setup

See the [parent readme](../../README.md) for details of how to set up and build the project.

## Routing Mechanism

Route providers create interceptors for endpoints (`GET/POST/PUT..`) via the `routerFactory`:

```ts
const router = routerFactory('/api/v2');
router.get('/my-endpoint', myInterceptingHandler());
// OR
routerFactory('/api/v2(my-endpoint').get('/', myInterceptingHandler());
```

This intercepting handler can:

- handle the request by executing custom behaviour and not forwarding
  - the [Validation RouteProvider](./src/routes/validation.ts)) delegates to the validation manager and stops the chain there
- handle the request by executing custom behaviour and forwarding to the next upstream
  - executing custom behaviour and then forward to the next upstream via `return next();` (see also example below)
- simply forward to the next upstream without any custom behaviour
  - forward directly to the next upstream via `return next();`. Please keep in mind that forwarding uses the requests'url to forward to the next upstream.
- pass and stop execution
  - if no custom behaviour is executed and no forward to upstream is triggered, the chain ends here

Important: If the chain is stopped by your route provider, please always ensure that the execution is also formally ended and a response is sent:

```ts
res.end();
```

### Model Uri Validation

The [`route-utils`](./src/routes/route-utils.ts) provides a utility wrapper hook that validates the model uri beforehand and passes it on to the intercepting handler via:

```ts
export function myInterceptingHandler(): ModelRequestHandler {
    return async (req: ModelRequest, res: Response, next: NextFunction) => {
        withValidatedModelUri(req, res, async validatedModelUri => {
            // execute some custom behaviour with the validated model uri
            ...
            // AND/OR forward request to upstream with validated model uri
            return next();
        });
    };
}
```

This example uses the validated model uri in some custom behaviour, and eventually forwards the request to the next upstream (via `return next()`).

### Binding of Route Providers

The default route providers are currently all bound in [one container module](./src/routes/routing-module.ts)
This is not optimal and unconvenient, for more details please see [Issue #64](https://github.com/eclipse-emfcloud/modelserver-node/issues/64) which aims to improve the module handling.
