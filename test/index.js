var test = require('../index')//.only();
var assert = require('assert');


test('Successful test', function() {
    assert.ok(true);
});

test('Failed test', function () {
    assert.equal(1, 2);
});

test('Async test', function (done) {
	setTimeout(function () {
		done();
	}, 2000);
});

test.skip('Skipped test', function () {

});

test('Skipped test 2');

test(function () {

});

// test(function NestedTestsContainer () {
// 	test('Nested test 1');

// 	test('Nested test 2', function () {

// 	});
// 	test('Nested test 3', function () {
// 		xxx;
// 	});
// 	test('Nested test 4', function () {
// 		test('Double nested test', function () {
// 			throw Error('xxx');
// 		});
// 	});
// });

test.only('Final', function () {

});

test('After-party', function () {

});