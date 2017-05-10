/**
 * Copyright 2017 aixigo AG
 * Released under the MIT license.
 * http://laxarjs.org/license
 */
import * as logActivity from '../laxar-log-activity';
import { object } from 'laxar';
import { text, ms } from './helper-functions';

import {
   createAxConfigurationMock,
   createAxEventBusMock,
   createAxLogMock
} from 'laxar/laxar-widget-service-mocks';

describe( 'A laxar-log-activity', () => {
   const axContext = {};
   let axConfiguration;
   let axFeatures;
   let axGlobalLog;
   let axLog;
   let axEventBus;

   let mockLogItemId;
   let mockLogTags;

   let fetchMock;
   let fetchMockConnected;
   let lastRequestBody;

   let originalTimeout;
   let messagesToSend;
   const thresholdSeconds = 120;
   const retries = 10;
   const retrySeconds = 180;

   const INSTANCE_ID = '12345';
   let injections;
   let baseTime;

   beforeEach( () => {
      initializeHttpMocks();

      jasmine.clock().install();
      originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
      createInjections();
      injections = [ axContext, axConfiguration, axEventBus, axFeatures, axGlobalLog, axLog ];
      logActivity.create( ...injections );

      jasmine.DEFAULT_TIMEOUT_INTERVAL = ms( axFeatures.logging.threshold.seconds + 1 );
      messagesToSend = [
         'laxar-log-activity spec: this info MUST be sent',
         'laxar-log-activity spec: this warning MUST be sent.',
         'laxar-log-activity spec: this error MUST be sent'
      ];
   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function createInjections() {
      axEventBus = createAxEventBusMock();
      axLog = createAxLogMock();
      const configuration = object.setPath(
         {}, 'widgets.laxar-log-activity.resourceUrl', 'http://test-repo:4711' );
      axConfiguration = createAxConfigurationMock( configuration );

      axGlobalLog = createAxLogMock();
      axFeatures = {
         logging: {
            enabled: true,
            requestPolicy: 'BATCH',
            threshold: {
               seconds: thresholdSeconds,
               messages: 100
            },
            retry: {
               enabled: true,
               seconds: retrySeconds,
               retries
            }
         },
         instanceId: { enabled: false },
         retry: { enabled: false }
      };

      mockLogTags = { INST: INSTANCE_ID };
      axGlobalLog.gatherTags.and.callFake( () => JSON.parse( JSON.stringify( mockLogTags ) ) );
      axGlobalLog.addLogChannel.and.callFake( channel => {
         Object.keys( axLog.levels ).forEach( level => {
            axLog[ level.toLowerCase() ].and.callFake( (text, ...replacements) => {
               const id = ++mockLogItemId;
               const tags = axGlobalLog.gatherTags();
               const sourceInfo = { file: 'fake.js', line: 4711 };
               const time = new Date();
               channel( { id, level, replacements, sourceInfo, tags, text, time } );
            } );
         } );
      } );
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   afterEach( () => {
      jasmine.clock().uninstall();
      jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
      lastRequestBody = '';
      axContext.commands.clearBuffer();
   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   it( 'doesn\'t submit the messages before one of the defined condition is fulfilled (R1.05, R1.09)', () => {
      axLog.info( messagesToSend[ 0 ] );
      axLog.warn( messagesToSend[ 1 ] );
      axLog.error( messagesToSend[ 2 ] );
      expect( fetchMock ).not.toHaveBeenCalled();
   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   describe( 'when the time threshold is reached', () => {

      beforeEach( () => {
         axLog.info( messagesToSend[ 0 ] );
         axLog.warn( messagesToSend[ 1 ] );
         axLog.error( messagesToSend[ 2 ] );
         jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      it( 'submits collected messages to the service (R1.05)', () => {
         expect( fetchMock ).toHaveBeenCalled();
         expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'after navigation and with new log messages when the time threshold is reached', () => {

         beforeEach( () => {
            axLog.info( messagesToSend[ 0 ] );
            axEventBus.publish( 'endLifecycleRequest', { lifecycleId: 'default' } );
            axEventBus.flush();
            logActivity.create( ...injections );
            axLog.warn( messagesToSend[ 1 ] );
            axLog.error( messagesToSend[ 2 ] );
            jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'submits collected messages to the service (R1.05)', () => {
            expect( fetchMock ).toHaveBeenCalled();
            expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
         } );

      } );

   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   describe( 'when a navigation is initiated and the time threshold is reached', () => {

      beforeEach( () => {
         axLog.info( messagesToSend[ 0 ] );
         axLog.warn( messagesToSend[ 1 ] );
         axLog.error( messagesToSend[ 2 ] );
         axEventBus.publish( 'endLifecycleRequest', { lifecycleId: 'default' } );
         axEventBus.flush();
         logActivity.create( ...injections );
         jasmine.clock().tick( ms( axFeatures.logging.threshold.seconds ) );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      it( 'a new activity on the second page submits collected messages to the service (#7, R1.05)', () => {
         expect( fetchMock ).toHaveBeenCalled();
         expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
      } );

   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   describe( 'when a navigation is initiated after the half time of threshold', () => {

      beforeEach( () => {
         baseTime = new Date();
         jasmine.clock().mockDate( baseTime );
         axLog.info( messagesToSend[ 0 ] );
         axLog.warn( messagesToSend[ 1 ] );
         axLog.error( messagesToSend[ 2 ] );
      } );

      afterEach( () => {
         jasmine.clock().tick( ( retries + 1 ) * ms( retrySeconds ) );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      it( 'doesn\'t submit the messages before the full time of threshold is reached (#7, R1.05)', done => {
         const halfMillisecondsThreshold = ms( axFeatures.logging.threshold.seconds / 2 );
         fetchMock.flushAsync()
            .then( () => {
               jasmine.clock().tick( halfMillisecondsThreshold );
               jasmine.clock().mockDate( new Date( baseTime.getTime() + halfMillisecondsThreshold ) );
               expect( fetchMock ).not.toHaveBeenCalled();
            } )
            .then( done, done.fail );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'and after the full time of threshold is reached (#7, R1.05)', () => {

         it( 'a new activity on the second page submits collected messages to the service', done => {
            const halfMillisecondsThreshold = ms( axFeatures.logging.threshold.seconds / 2 );

            fetchMock.flushAsync()
               .then( () => {
                  jasmine.clock().tick( halfMillisecondsThreshold );
                  expect( fetchMock ).not.toHaveBeenCalled();
               } )
               .then( () => {
                  axEventBus.publish( 'endLifecycleRequest', { lifecycleId: 'default' } );
                  axEventBus.flush();
                  logActivity.create( ...injections );
                  expect( fetchMock ).not.toHaveBeenCalled();
               } )
               .then( () => {
                  jasmine.clock().tick( halfMillisecondsThreshold );
                  expect( fetchMock ).toHaveBeenCalled();
                  expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
               } )
               .then( done, done.fail );
         } );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'and after another navigation and the full time of threshold is reached', () => {

         it( 'a new activity on the third page submits collected messages to the service (#7, R1.05)',
            done => {
               const halfMillisecondsThreshold = ms( axFeatures.logging.threshold.seconds / 2 );
               const quarterMillisecondsThreshold = ms( axFeatures.logging.threshold.seconds / 4 );

               fetchMock.flushAsync()
                  .then( () => {
                     jasmine.clock().tick( quarterMillisecondsThreshold );
                     expect( fetchMock ).not.toHaveBeenCalled();
                  } )
                  .then( () => {
                     axEventBus.publish( 'endLifecycleRequest', { lifecycleId: 'default' } );
                     axEventBus.flush();
                     logActivity.create( ...injections );
                     expect( fetchMock ).not.toHaveBeenCalled();
                  } )
                  .then( () => {
                     jasmine.clock().tick( quarterMillisecondsThreshold );
                     expect( fetchMock ).not.toHaveBeenCalled();
                  } )
                  .then( () => {
                     axEventBus.publish( 'endLifecycleRequest', { lifecycleId: 'default' } );
                     axEventBus.flush();
                     logActivity.create( ...injections );
                     expect( fetchMock ).not.toHaveBeenCalled();
                  } )
                  .then( () => {
                     jasmine.clock().tick( halfMillisecondsThreshold );
                     expect( fetchMock ).toHaveBeenCalled();
                     expect( lastRequestBody.messages.map( text ) ).toEqual( messagesToSend );
                  } )
                  .then( done, done.fail );
            }
         );
      } );
   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   describe( 'with retry enabled and when disconnected before and after navigation', () => {

      const messageToLose = 'laxar-log-activity spec: This message MUST NOT be re-sent';
      const messageToSentDirect = 'laxar-log-activity spec: This message MUST be sent';

      beforeEach( () => {
         baseTime = new Date();
         jasmine.clock().mockDate( baseTime );
         fetchMockConnected = false;
         axLog.info( `${messageToLose} 0` );
         jasmine.clock().tick( ms( thresholdSeconds ) );
         axEventBus.publish( 'endLifecycleRequest', { lifecycleId: 'default' } );
         axEventBus.flush();
         logActivity.create( ...injections );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      it( 'retries to submit the failed messages after a configured time seconds (#7, R1.20)', done => {
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

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      it( 'retries to submit the failed messages only a configured number of retries (#7, R1.20)', done => {
         expect( fetchMock.calls.count() ).toEqual( 1 );

         fetchMock.flushAsync()
            .then( () => {
               jasmine.clock().tick( ms( retrySeconds ) );
               expect( fetchMock.calls.count() ).toEqual( 2 );
               return fetchMock.flushAsync();
            } )
            .then( () => {
               jasmine.clock().tick( ( retries + 20 ) * ms( retrySeconds ) );
               return fetchMock.flushAsync();
            } )
            .then( () => {
               expect( fetchMock.calls.count() ).toEqual( retries + 1 );
               return fetchMock.flushAsync();
            } )
            .then( done, done.fail );
      } );

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      describe( 'and the service is available again and new messages are logged', () => {

         beforeEach( () => {
            fetchMockConnected = true;
            axLog.info( `${messageToSentDirect} 0` );
            axLog.info( `${messageToSentDirect} 1` );
         } );

         /////////////////////////////////////////////////////////////////////////////////////////////////////

         it( 'retries to submit the failed messages without the new collected ones (#7, R1.20)', done => {
            expect( fetchMock.calls.count() ).toEqual( 1 );
            fetchMock.flushAsync()
               .then( () => {
                  jasmine.clock().tick( Math.max( ms( retrySeconds ), ms( thresholdSeconds ) ) );
                  expect( fetchMock.calls.count() ).toEqual( 3 );
               } )
               .then( done, done.fail );
            expect( lastRequestBody.messages.map( text ) ).toEqual( [
               `${messageToLose} 0`
            ] );
         } );
      } );
   } );

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   function initializeHttpMocks() {
      fetchMockConnected = true;
      fetchMock = window.fetch = jasmine.createSpy( 'fetchMock' )
         .and.callFake( (url, { method, body } ) => {
            expect( method ).toEqual( 'POST' );
            lastRequestBody = JSON.parse( body );
            return fetchMockConnected ? Promise.resolve() : Promise.reject();
         } );
      fetchMock.flushAsync = () => Promise.resolve();

      ////////////////////////////////////////////////////////////////////////////////////////////////////////

      function XMLHttpRequest() {
         this.open = jasmine.createSpy( 'xhrOpen' ).and.callFake( ( method, url, syncFlag ) => {
            expect( syncFlag ).toBe( true );
         } );
         this.send = jasmine.createSpy( 'xhrSend' ).and.callFake( body => {
            lastRequestBody = JSON.parse( body );
         } );
      }
      window.XMLHttpRequest = XMLHttpRequest;
   }

} );

