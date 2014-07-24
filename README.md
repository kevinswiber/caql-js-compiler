# caql-js-compiler

Compile CaQL queries into executable JavaScript.

Learn more: [Calypso Query Language (CaQL) Specification](https://github.com/kevinswiber/caql).

## Install

`npm install caql-js-compiler`

## Example

```js
var JSCompiler = require('caql-js-compiler');

var entries = [
  { name: 'Postini', founded_year: 1999, total_money_raised: '$0' },
  { name: 'Digg', founded_year: 2004, total_money_raised: '$45M' },
  { name: 'Airbnb', founded_year: 2007, total_money_raised: '$120M' },
  { name: 'TripIt', founded_year: 2006, total_money_raised: '$13.1M' },
  { name: 'Twitter', founded_year: 2006, total_money_raised: '$1.16B' },
  { name: 'Spotify', founded_year: 2006, total_money_raised: '$183M' },
  { name: 'Airbnb', founded_year: 2008, total_money_raised: '$776.4M' }
];

var compiler = new JSCompiler();

var query =   'select name, founded_year, total_money_raised as worth '
            + 'where founded_year >= 1999 and name not like "%air%" '
            + 'order by founded_year desc, name';

compiler
  .compile(query)
  .execute(entries)
  .forEach(function(result) {
    console.log(result);
  });

// Output:
//
//    { name: 'Spotify', founded_year: 2006, worth: '$183M' }
//    { name: 'TripIt', founded_year: 2006, worth: '$13.1M' }
//    { name: 'Twitter', founded_year: 2006, worth: '$1.16B' }
//    { name: 'Digg', founded_year: 2004, worth: '$45M' }
//    { name: 'Postini', founded_year: 1999, worth: '$0' }

```

## License

MIT
