/* eslint-env node */

const pkg = require( './package.json' );
const laxarInfrastructure = require( 'laxar-infrastructure' );

module.exports = function( config ) {
   config.set( karmaConfig() );
};

function karmaConfig() {
   return laxarInfrastructure.karma( [ `spec/${pkg.name}.spec.js` ], {
      context: __dirname,
      rules: require( './webpack.config' )[ 0 ].module.rules
   } );
}
