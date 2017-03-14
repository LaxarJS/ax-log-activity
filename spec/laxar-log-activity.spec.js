/**
 * Copyright 2016-2017 aixigo AG
 * Released under the MIT license.
 * http://laxarjs.org/license
 */
import * as axMocks from 'laxar-mocks';

describe( 'A laxar-log-activity', () => {

   let axConfiguration;
   let axContext;
   let axFeatures;
   let axGlobalLog;
   let axLog;

   let mockLogItemId;
   let mockLogTags;
   let mockLogResourceUrl;
   let mockLogThreshold;

   let xhrInstanceMock;
   let fetchMock;
   let fetchMockConnected;
   let lastRequestBody;
   let lastRequestHeaders;
   let numberOfMessageBatches;

   const INSTANCE_ID = '12345';
   let originalTimeout;

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function initializeHttpMocks() {
      fetchMockConnected = true;
      fetchMock = window.fetch = jasmine.createSpy( 'fetchMock' )
         .and.callFake( (url, { method, body, headers } ) => {
            expect( method ).toEqual( 'POST' );
            ++numberOfMessageBatches;
            lastRequestBody = JSON.parse( body );
            lastRequestHeaders = JSON.parse( JSON.stringify( headers ) );
            return fetchMockConnected ? Promise.resolve() : Promise.reject();
         } );
      fetchMock.flushAsync = () => Promise.resolve();

      function XMLHttpRequest() {
         xhrInstanceMock = this;
         this.open = jasmine.createSpy( 'xhrOpen' ).and.callFake( ( method, url, syncFlag ) => {
            expect( syncFlag ).toBe( true );
         } );
         this.send = jasmine.createSpy( 'xhrSend' ).and.callFake( body => {
            lastRequestBody = JSON.parse( body );
         } );
      }
      window.XMLHttpRequest = XMLHttpRequest;
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function initializeWidgetServiceMocks( options ) {
      ({ mockLogResourceUrl = 'http://test-repo:4711', mockLogThreshold = 'INFO' } = options);
      return services => {
         ({ axConfiguration, axContext, axFeatures, axGlobalLog, axLog } = services);

         axConfiguration.get.and.callFake( path => {
            expect( path ).toEqual( 'widgets.laxar-log-activity.resourceUrl' );
            return mockLogResourceUrl;
         } );

         mockLogTags = { INST: INSTANCE_ID };
         axGlobalLog.gatherTags.and.callFake( () => JSON.parse( JSON.stringify( mockLogTags ) ) );
         axGlobalLog.addLogChannel.and.callFake( channel => {
            Object.keys( axLog.levels ).forEach( level => {
               if( axLog.levels[ level ] < axLog.levels[ mockLogThreshold ] ) { return; }
               axLog[ level.toLowerCase() ].and.callFake( (text, ...replacements) => {
                  const id = ++mockLogItemId;
                  const tags = axGlobalLog.gatherTags();
                  const sourceInfo = { file: 'fake.js', line: 4711 };
                  const time = new Date();
                  channel( { id, level, replacements, sourceInfo, tags, text, time } );
               } );
            } );
         } );
      };
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function createSetup( widgetConfiguration, options = {} ) {

      beforeEach( () => {
         numberOfMessageBatches = 0;
         originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
         initializeHttpMocks();
      } );

      beforeEach( () => {
         jasmine.clock().install();
         axMocks.widget.whenServicesAvailable( initializeWidgetServiceMocks( options ) );
         axMocks.widget.configure( widgetConfiguration );
      } );

      beforeEach( axMocks.widget.load );
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   beforeEach( axMocks.setupForWidget() );

   afterEach( done => {
      jasmine.clock().uninstall();
      jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
      if( axContext.commands ) {
         axContext.commands.clearBuffer();
      }
      axMocks.tearDown( done );
   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   describe( 'to implement feature logging', () => {

      describe( 'when disabled', () => {
         createSetup( { logging: { enabled: false } } );

         beforeEach( () => {
            axLog.warn( 'laxar-log-activity spec: this warning MUST not be posted' );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'does not perform any HTTP communication (R1.01)', () => {
            expect( fetchMock ).not.toHaveBeenCalled();
         } );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'when receiving portal log messages below the configured threshold', () => {

         createSetup( {} );

         beforeEach( () => {
            axLog.info( 'laxar-log-activity spec: this info MUST be bcolluffered' );
            axLog.warn( 'laxar-log-activity spec: this warning MUST be buffered' );
            axLog.error( 'laxar-log-activity spec: this error MUST be buffered' );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'defers sending them (R1.02)', () => {
            expect( fetchMock ).not.toHaveBeenCalled();
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'when created', () => {

         createSetup( {} );

         it( 'tries to read the log resource URL from configuration (R1.03)', () => {
            expect( axConfiguration.get ).toHaveBeenCalled();
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'when log resource configuration is missing', () => {

         createSetup( {}, { mockLogResourceUrl: null } );

         it( 'logs an error (R1.04)', () => {
            expect( axLog.error ).toHaveBeenCalledWith( 'resourceUrl not configured' );
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'using the default time threshold, when that is reached', () => {
         let messagesToSend;
         createSetup( {} );

         beforeEach( () => {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = ms( axFeatures.logging.threshold.seconds + 1 );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'submits collected messages to the service as items (R1.05)', () => {
            messagesToSend = [
               'laxar-log-activity spec: this info MUST be sent',
               'laxar-log-activity spec: this warning MUST be sent.',
               'laxar-log-activity spec: this error MUST be sent'
            ];
            axLog.debug( 'laxar-log-activity spec: this debug message MUST NOT be sent' );
            axLog.info( messagesToSend[ 0 ] );
            axLog.warn( messagesToSend[ 1 ] );
            axLog.error( messagesToSend[ 2 ] );
            expect( fetchMock ).not.toHaveBeenCalled();
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
            axLog.info( 'laxar-log-activity spec: this message MUST NOT be sent with the first batch' );
            expect( fetchMock ).toHaveBeenCalled();
            expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'substitutes placeholders in log messages (R1.15)', () => {
            expect( fetchMock ).not.toHaveBeenCalled();
            axLog.info( 'laxar-log-activity spec: This is a [0] and another [1].', 'placeholder', 1 );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
            const item = lastRequestBody.messages[ 0 ];
            expect( item.text ).toEqual( 'laxar-log-activity spec: This is a placeholder and another 1.' );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'stringifies objects when replacing placeholders in log messages (R1.15)', () => {
            axLog.info( 'laxar-log-activity spec: This is a [0].', { 'json': 'stringified object' } );
            axLog.info( 'laxar-log-activity spec: This is a [0].', [ { 'json': 'stringified' }, 'array' ] );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );

            let item;
            item = lastRequestBody.messages[ 0 ];
            expect( item.text )
               .toEqual( 'laxar-log-activity spec: This is a {"json":"stringified object"}.' );
            item = lastRequestBody.messages[ 1 ];
            expect( item.text )
               .toEqual( 'laxar-log-activity spec: This is a [{"json":"stringified"},"array"].' );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'treats the escaped backslash-escaped characters as normal text (R1.15)', () => {
            axLog.info( 'laxar-log-activity spec: This \\[0] is not a placeholder', 4711 );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
            const item = lastRequestBody.messages[ 0 ];
            expect( item.text ).toEqual( 'laxar-log-activity spec: This [0] is not a placeholder' );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         describe( 'when a message with log tags was logged', () => {

            beforeEach( () => {
               mockLogTags[ 'TAG1' ] = 'My tag';
               mockLogTags[ 'TAG2' ] = 'My other tag';
               axLog.info( 'Log Activity spec: Text' );
               jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
            } );

            //////////////////////////////////////////////////////////////////////////////////////////////////

            it( 'appends the log tags to the message (R1.16)', () => {
               const item = lastRequestBody.messages[ 0 ];
               const tags = item.tags;
               expect( tags ).toContain( `INST:${INSTANCE_ID}` );
               expect( tags ).toContain( 'TAG1:My tag' );
               expect( tags ).toContain( 'TAG2:My other tag' );
            } );

         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'assigns the application instance identifier as tag INST to the items (R1.17)', () => {
            axLog.info( 'laxar-log-activity spec: this info MUST be sent' );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
            const item = lastRequestBody.messages[ 0 ];
            expect( item.tags ).toContain( `INST:${INSTANCE_ID}` );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'submits the log level with each item (R1.18)', () => {
            messagesToSend = [
               'laxar-log-activity spec: this info MUST be sent',
               'laxar-log-activity spec: this warning MUST be sent.',
               'laxar-log-activity spec: this error MUST be sent'
            ];
            axLog.info( messagesToSend[ 0 ] );
            axLog.warn( messagesToSend[ 1 ] );
            axLog.error( messagesToSend[ 2 ] );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
            expect( lastRequestBody.messages[ 0 ].level ).toEqual( 'INFO' );
            expect( lastRequestBody.messages[ 1 ].level ).toEqual( 'WARN' );
            expect( lastRequestBody.messages[ 2 ].level ).toEqual( 'ERROR' );
         } );


         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'submits the creation time with each item (R1.18)', () => {
            axLog.info( 'laxar-log-activity spec: this info MUST be sent' );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
            expect( lastRequestBody.messages[ 0 ].time ).toEqual( jasmine.any( String ) );
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'using the user-defined time threshold, when that is reached', () => {
         let messagesToSend;
         const userSetThresholdSeconds = 777;
         const userSetThresholdMs = ms( userSetThresholdSeconds );

         createSetup( { logging: { threshold: { seconds: userSetThresholdSeconds } } } );

         beforeEach( () => {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = ms( userSetThresholdSeconds + 1 );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'submits collected messages to the service (R1.06)', () => {
            messagesToSend = [ 'laxar-log-activity spec: this info MUST be sent' ];
            axLog.info( messagesToSend[ 0 ] );
            jasmine.clock().tick( userSetThresholdMs - 1 );
            expect( fetchMock ).not.toHaveBeenCalled();
            jasmine.clock().tick( 1 );
            axLog.info( 'laxar-log-activity spec: this message MUST NOT be sent' );
            jasmine.clock().tick( userSetThresholdMs - 1 );
            expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
         } );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'using the request policy "PER_MESSAGE"', () => {

         let limit = 3;
         createSetup( {
            logging: {
               threshold: { messages: limit },
               requestPolicy: 'PER_MESSAGE'
            }
         } );

         beforeEach( () => {
            limit = axFeatures.logging.threshold.messages;
            for( let i = 0; i < limit; ++i ) {
               axLog.info( `laxar-log-activity spec: message number ${i}` );
            }
            jasmine.clock().tick( 0 );
         } );

         it( 'submits collected messages to the service per message (R1.07)', () => {
            expect( numberOfMessageBatches ).toEqual( 3 );
            expect( lastRequestBody.text ).toEqual( 'laxar-log-activity spec: message number 2' );
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'when the event window.beforeunload is triggered', () => {

         let messagesToSend;
         createSetup( {} );

         beforeEach( () => {
            messagesToSend = [ 'laxar-log-activity spec: this info MUST be sent' ];
            axLog.info( messagesToSend[ 0 ] );
            axContext.commands.handleBeforeUnload();
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'immediately submits collected messages to the log service (R1.08)', () => {
            expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'uses the XHR API rather than fetch, for synchronous delivery', () => {
            expect( fetchMock ).not.toHaveBeenCalled();
            expect( xhrInstanceMock ).toBeDefined();
            expect( xhrInstanceMock.open ).toHaveBeenCalledWith( 'POST', mockLogResourceUrl, true );
            expect( xhrInstanceMock.send ).toHaveBeenCalled();
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'using the default maximum number of messages', () => {

         let limit;
         createSetup( {} );

         beforeEach( () => {
            limit = axFeatures.logging.threshold.messages;
            for( let i = 0; i < limit - 1; ++i ) {
               axLog.info( `laxar-log-activity spec: message number ${i}` );
            }
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'buffers as long as that has not been reached (R1.09, R1.11)', () => {
            expect( numberOfMessageBatches ).toEqual( 0 );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         describe( 'when that is reached', () => {

            beforeEach( () => {
               axLog.info( `laxar-log-activity spec: message number ${limit - 1}` );
               axLog.info( 'laxar-log-activity spec: this message MUST NOT be sent in the first batch' );
            } );

            //////////////////////////////////////////////////////////////////////////////////////////////////

            it( 'submits collected messages to the service (R1.09, R1.11)', () => {
               expect( numberOfMessageBatches ).toEqual( 1 );
               expect( lastRequestBody.messages.length ).toEqual( limit );
            } );

         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'using a user-defined maximum number of messages', () => {

         const limit = 7;

         createSetup( { logging: { threshold: { messages: limit } } } );

         beforeEach( () => {
            for( let i = 0; i < limit - 1; ++i ) {
               axLog.info( `laxar-log-activity spec: message number ${i}` );
            }
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'buffers as long as that has not been reached (R1.10, R1.11)', () => {
            expect( numberOfMessageBatches ).toEqual( 0 );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         describe( 'when that is reached', () => {

            beforeEach( () => {
               axLog.info( `laxar-log-activity spec: message number ${limit - 1}` );
               axLog.info( 'laxar-log-activity spec: this message MUST NOT be sent in the first batch' );
            } );

            //////////////////////////////////////////////////////////////////////////////////////////////////

            it( 'submits collected messages to the service (R1.10, R1.11)', () => {
               expect( numberOfMessageBatches ).toEqual( 1 );
               expect( lastRequestBody.messages.length ).toEqual( limit );
            } );

         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'when receiving a didEncounterError event', () => {

         createSetup( {} );

         beforeEach( () => {
            const errorData = {
               code: 'HTTP_GET',
               message: 'laxar-log-activity spec: simulated error',
               data: {
                  text: '404 Not Found'
               }
            };
            axMocks.eventBus.publish( `didEncounterError.${errorData.code}`, errorData );
            axMocks.eventBus.flush();
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'generates a corresponding log message (R1.13)', () => {
            expect( axLog.error ).toHaveBeenCalledWith(
               '([0]) [1]', 'HTTP_GET', 'laxar-log-activity spec: simulated error'
            );
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'when multiple identical log messages are received in a row', () => {

         const batchSize = 3;
         const repetitions = 10;
         const repeatedMessage = 'laxar-log-activity spec: repeated message that MUST be logged once';
         const otherMessage =
            'laxar-log-activity spec: Another message that MUST be logged in the first batch';

         createSetup( { logging: { threshold: { messages: batchSize } } } );

         beforeEach( () => {
            for( let i = 0; i < repetitions; ++i ) {
               axLog.info( repeatedMessage );
            }
            axLog.warn( otherMessage );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'collapses them into one message on receipt (R1.14)', () => {
            expect( numberOfMessageBatches ).toEqual( 1 );
            expect( lastRequestBody.messages.length ).toEqual( 2 );

            const firstMessage = text( lastRequestBody.messages[ 0 ] );
            expect( firstMessage ).not.toEqual( repeatedMessage );
            expect( firstMessage ).toContain( repeatedMessage );
            expect( firstMessage ).toContain( '10x' );
            expect( text( lastRequestBody.messages[ 1 ] ) ).toEqual( otherMessage );
         } );

      } );

   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   describe( 'when a communication error occurs', () => {

      const messageToLose = 'laxar-log-activity spec: This message MUST NOT be re-sent';
      const messageToKeep = 'laxar-log-activity spec: This message MUST be sent';
      const messageToSentDirect = 'laxar-log-activity spec: This message MUST be sent';
      const thresholdSeconds = 100;
      const retrySeconds = 100;
      const retries = 4;

      beforeEach( () => {
         axMocks.widget.whenServicesAvailable( () => {
            fetchMockConnected = false;
         } );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'and with retry enabled', () => {

         createSetup( {
            logging: {
               threshold: {
                  seconds: thresholdSeconds
               },
               retry: {
                  enabled: true,
                  seconds: retrySeconds,
                  retries
               }
            }
         } );

         beforeEach( () => {
            axLog.info( `${messageToLose} 0` );
            jasmine.clock().tick( ms( thresholdSeconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         afterEach( () => {
            jasmine.clock().tick( ( retries + 1 ) * ms( retrySeconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'retries to submit the failed messages after a configured time seconds (R1.20)', done => {
            expect( fetchMock.calls.count() ).toEqual( 1 );

            fetchMock.flushAsync()
               .then( () => {
                  jasmine.clock().tick( ms( retrySeconds ) );
                  expect( fetchMock.calls.count() ).toEqual( 2 );
                  return fetchMock.flushAsync();
               } )
               .then( () => {
                  jasmine.clock().tick( ms( retrySeconds ) );
                  expect( fetchMock.calls.count() ).toEqual( 3 );
               } )
               .then( done, done.fail );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'retries to submit the failed messages only a configured number of retries (R1.20)', done => {
            expect( fetchMock.calls.count() ).toEqual( 1 );

            fetchMock.flushAsync()
               .then( () => {
                  jasmine.clock().tick( ms( retrySeconds ) );
                  expect( fetchMock.calls.count() ).toEqual( 2 );
                  return fetchMock.flushAsync();
               } )
               .then( () => awaitRetries( ms( retrySeconds ), retries ) )
               .then( () => {
                  expect( fetchMock.calls.count() ).toEqual( retries + 1 );
                  return fetchMock.flushAsync();
               } )
               .then( done, done.fail );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         describe( 'and the service is available again and new messages are logged', () => {

            beforeEach( () => {
               fetchMockConnected = true;
               axLog.info( `${messageToSentDirect} 0` );
               axLog.info( `${messageToSentDirect} 1` );
            } );

            //////////////////////////////////////////////////////////////////////////////////////////////////

            it( 'retries to submit the failed messages without the new collected ones (R1.20)', done => {
               expect( fetchMock.calls.count() ).toEqual( 1 );
               fetchMock.flushAsync()
                  .then( () => {
                     jasmine.clock().tick( Math.max( ms( retrySeconds ), ms( thresholdSeconds ) ) );
                     expect( fetchMock.calls.count() ).toEqual( 3 );
                  } )
                  .then( done, done.fail );
            } );

         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'without retry', () => {

         createSetup( {} );

         beforeEach( () => {
            axLog.info( `${messageToLose} 0` );
            axLog.info( `${messageToLose} 1` );
            axLog.info( `${messageToLose} 2` );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );

            fetchMock.calls.reset();
            fetchMockConnected = true;
            axLog.info( `${messageToKeep} 0` );
            axLog.info( `${messageToKeep} 1` );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'discards failed messages (R1.12)', () => {
            expect( fetchMock.calls.count() ).toEqual( 1 );
            expect( lastRequestBody.messages.map( text ) ).toEqual( [
               `${messageToKeep} 0`,
               `${messageToKeep} 1`
            ] );
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'and with retry enabled and the request policy "PER_MESSAGE"', () => {

         createSetup( {
            logging: {
               threshold: {
                  seconds: thresholdSeconds
               },
               requestPolicy: 'PER_MESSAGE',
               retry: {
                  enabled: true,
                  seconds: retrySeconds,
                  retries
               }
            }
         } );

         beforeEach( () => {
            axLog.info( `${messageToLose} 0` );
            jasmine.clock().tick( ms( thresholdSeconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         afterEach( () => {
            jasmine.clock().tick( ms( retrySeconds ) * retries );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'retries to submit the failed messages after a configured time interval (R1.20)', done => {
            expect( fetchMock.calls.count() ).toEqual( 1 );
            fetchMock.flushAsync()
               .then( () => {
                  jasmine.clock().tick( ms( retrySeconds ) );
                  expect( fetchMock.calls.count() ).toEqual( 2 );
               } )
               .then( done, done.fail );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'retries to submit the failed messages only a configured number of retries (R1.20)', done => {
            expect( fetchMock.calls.count() ).toEqual( 1 );
            fetchMock.flushAsync()
               .then( () => awaitRetries( ms( retrySeconds ), retries ) )
               .then( () => {
                  expect( fetchMock.calls.count() ).toEqual( retries + 1 );
               } )
               .then( () => awaitRetries( ms( retrySeconds ), 1 ) )
               .then( () => {
                  expect( fetchMock.calls.count() ).toEqual( retries + 1 );
               } )
               .then( done, done.fail );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         describe( 'and the service is available again and new messages are logged', () => {

            beforeEach( () => {
               fetchMockConnected = true;
               axLog.info( `${messageToSentDirect} 0` );
               axLog.info( `${messageToSentDirect} 1` );
            } );

            //////////////////////////////////////////////////////////////////////////////////////////////////

            it( 'retries to submit the failed messages without the new collected ones (R1.20)', () => {
               expect( fetchMock.calls.count() ).toEqual( 1 );
               jasmine.clock().tick( Math.max( ms( retrySeconds ), ms( thresholdSeconds ) ) );
               expect( fetchMock.calls.count() ).toEqual( 3 );
            } );

         } );
      } );
   } );


   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   describe( 'with instanceId configuration', () => {

      describe( 'when instanceId disabled', () => {

         createSetup( {} );

         beforeEach( () => {
            axLog.info( 'laxar-log-activity spec: this info MUST be buffered' );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'sends a headers with an empty object (R1.21)', () => {
            expect( lastRequestHeaders ).toEqual( {} );
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'when instanceId enabled', () => {

         createSetup( {
            instanceId: {
               enabled: true
            }
         } );

         beforeEach( () => {
            axLog.info( 'laxar-log-activity spec: this info MUST be buffered' );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'uses the default header (R1.21)', () => {
            expect( lastRequestHeaders[ 'x-laxar-log-tags' ] ).toBeDefined();
         } );

      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'and a configured name for the header', () => {

         createSetup( {
            instanceId: {
               enabled: true,
               header: 'x-individual-name'
            }
         } );

         beforeEach( () => {
            axLog.info( 'laxar-log-activity spec: this info MUST be buffered' );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'uses the configured header (R1.21)', () => {
            expect( lastRequestHeaders[ 'x-individual-name' ] ).toBeDefined();
         } );

      } );

   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function text( messageItem ) {
      return messageItem.text;
   }

   function ms( seconds ) {
      return seconds * 1000;
   }

   function range( numItems ) {
      const r = new Array( numItems );
      for( let i = 0; i <= numItems; ++i ) { r[ i ] = i; }
      return r;
   }

   function awaitRetries( retryMs, numRetries ) {
      return range( numRetries ).reduce(
         prev => prev.then( () => {
            jasmine.clock().tick( retryMs );
            return fetchMock.flushAsync();
         } ),
         Promise.resolve()
      );
   }

} );
