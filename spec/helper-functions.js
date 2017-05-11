/**
 * Copyright 2017 aixigo AG
 * Released under the MIT license.
 * http://laxarjs.org/license
 */

export function text( messageItem ) {
   return messageItem.text;
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function ms( seconds ) {
   return seconds * 1000;
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function awaitRetries( retryMs, numRetries, fetchMock ) {

   function range( numItems ) {
      const r = new Array( numItems );
      for( let i = 0; i <= numItems; ++i ) { r[ i ] = i; }
      return r;
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   return range( numRetries ).reduce(
      prev => prev.then( () => {
         jasmine.clock().tick( retryMs );
         return fetchMock.flushAsync();
      } ),
      Promise.resolve()
   );
}
