/**
 * Copyright 2017 aixigo AG
 * Released under the MIT license.
 * http://laxarjs.org/license
 */
import { string } from 'laxar';

// Messages up to this index have been captured
let lastMessageId = -1;
let buffer = [];
let resendBuffer = [];

const formatMessage = createMessageFormatter();

// export for use from tests
export function clearBuffer() {
   buffer = [];
   resendBuffer = [];
}

export const injections =
   [ 'axContext', 'axConfiguration', 'axEventBus', 'axFeatures', 'axGlobalLog', 'axLog' ];

export function create( context, configuration, eventBus, features, globalLog, log ) {

   if( !features.logging.enabled ) { return; }

   const logResourceUrl = configuration.get( 'widgets.laxar-log-activity.resourceUrl', null );
   if( !logResourceUrl ) {
      log.error( 'resourceUrl not configured' );
      return;
   }

   const instanceId = globalLog.gatherTags()[ 'INST' ];
   const headers = {};
   if( features.instanceId.enabled ) {
      headers[ features.instanceId.header ] = `[INST:${instanceId}]`;
      headers[ 'Content-Type' ] = 'application/json';
   }

   const { threshold, retry } = features.logging;
   const ms = s => 1000 * s;

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////
   // Collect log messages and submit them periodically:

   globalLog.addLogChannel( handleLogItem );
   let retryTimeout;
   let timeout;

   const dateNow = Date.now();
   const nextSubmit = window.nextSubmit || dateNow + ms( threshold.seconds );

   if( dateNow >= nextSubmit ) {
      submit();
   }
   else {
      window.nextSubmit = Date.now() + ms( threshold.seconds );
      timeout = window.setTimeout( submit, nextSubmit - dateNow );
   }

   eventBus.subscribe( 'endLifecycleRequest', () => {
      globalLog.removeLogChannel( handleLogItem );
      window.clearTimeout( timeout );
      window.clearTimeout( ms( retry.seconds ) );
      window.removeEventListener( 'beforeunload', handleBeforeUnload );
   } );

   // Log error events in order to include them
   eventBus.subscribe( 'didEncounterError', ({ code, message }) => {
      log.error( '([0]) [1]', code, message );
   } );


   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   // Submit messages before browser unload:
   function handleBeforeUnload() {
      submit( true );
      window.clearTimeout( timeout );
      window.clearTimeout( retryTimeout );
   }
   window.addEventListener( 'beforeunload', handleBeforeUnload );
   // Allow to perform cleanup from tests without confusing karma or jasmine
   context.commands = { handleBeforeUnload, clearBuffer };

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function handleLogItem( item ) {
      if( item.id <= lastMessageId ) { return; }
      lastMessageId = item.id;

      const tags = [ `INST:${item.tags.INST || instanceId}` ].concat(
         Object.keys( item.tags )
            .filter( tag => tag !== 'INST' )
            .map( tag => `${tag}:${item.tags[ tag ]}` )
      );

      const textAndReplacements = formatMessage( item.text, item.replacements );
      const messageItem = {
         file: item.sourceInfo.file,
         line: item.sourceInfo.line,
         level: item.level,
         repetitions: 1,
         replacements: textAndReplacements.replacements,
         tags,
         text: textAndReplacements.text,
         time: item.time.toISOString()
      };

      if( markDuplicate( messageItem ) ) {
         return;
      }

      buffer.push( messageItem );
      if( buffer.length >= threshold.messages ) {
         submit();
      }

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      function markDuplicate( item ) {
         const numItemsToCheck = 2;
         const n = buffer.length;
         for( let i = n - 1; i >= 0 && i >= n - numItemsToCheck; --i ) {
            const previousItem = buffer[ i ];
            if( [ 'line', 'file', 'level', 'text' ].every( _ => item[ _ ] === previousItem[ _ ] ) ) {
               ++previousItem.repetitions;
               return true;
            }
         }
         return false;
      }
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function submit( synchronously ) {
      window.clearTimeout( timeout );
      timeout = window.setTimeout( submit, ms( threshold.seconds ) );
      window.nextSubmit = Date.now() + ms( threshold.seconds );

      if( !buffer.length ) {
         return;
      }

      buffer
         .filter( message => message.repetitions > 1 )
         .forEach( message => { message.text += ` (repeated ${message.repetitions}x)`; } );

      const { requestPolicy } = features.logging;
      const source = document.location.origin;
      const chunks = requestPolicy === 'BATCH' ?
         [ { messages: buffer, source } ] :
         buffer.map( _ => ({ ..._, source }) );

      chunks.forEach( send );
      buffer = [];

      function send( request ) {
         const payload = JSON.stringify( request );
         postTo( logResourceUrl, payload, synchronously )
            .catch( () => {
               if( retry.enabled && !synchronously ) {
                  resendBuffer.push( { payload, retriesLeft: retry.retries } );
                  window.clearTimeout( retryTimeout );
                  retryTimeout = window.setTimeout( resendMessages, ms( retry.seconds ) );
               }
            } );
      }
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function resendMessages( synchronously ) {
      window.clearTimeout( retryTimeout );
      resendBuffer = resendBuffer.filter( item => item.retriesLeft > 0 );
      if( resendBuffer.length > 0 ) {
         retryTimeout = window.setTimeout( resendMessages, ms( retry.seconds ) );
      }
      resendBuffer.forEach( item => {
         postTo( logResourceUrl, item.payload, synchronously )
            .then(
               () => { item.retriesLeft = 0; },
               () => { --item.retriesLeft; }
            );
      } );
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function postTo( url, body, synchronously ) {
      if( !synchronously ) {
         return fetch( url, {
            method: 'POST',
            mode: 'cors',
            credentials: 'same-origin',
            headers,
            body
         } );
      }

      // use old-school XHR because as synchronous fallback (page-unload)
      const request = new XMLHttpRequest();
      request.open( 'POST', url, true );
      Object.keys( headers ).forEach( name => {
         request.setRequestHeader( name, headers[ name ] );
      } );
      request.send( body );
      return Promise.resolve();
   }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

function createMessageFormatter() {
   const formatters = { ...string.DEFAULT_FORMATTERS, 'default': defaultFormatter };

   return ( text, replacements ) => {
      const anonymizeReplacements = [];
      const mappers = {
         anonymize( value ) {
            anonymizeReplacements.push( value );
            return `[${anonymizeReplacements.length - 1}:anonymize]`;
         }
      };
      const format = string.createFormatter( formatters, mappers );
      return {
         text: format( text, replacements ),
         replacements: anonymizeReplacements
      };
   };
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

function defaultFormatter( value, subSpecifier ) {
   if( value instanceof Error ) {
      const { message, stack = '' } = value;
      return JSON.stringify( { message, stack } );
   }
   if( typeof value === 'object' && value != null ) {
      return JSON.stringify( value );
   }
   return string.DEFAULT_FORMATTERS[ 'default' ]( value, subSpecifier );
}
