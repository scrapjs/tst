var chalk = require('chalk');
var isBrowser = require('is-browser');
var now = require('performance-now');
var elegantSpinner = require('elegant-spinner');
var logUpdate = require('log-update');
var ansi = require('ansi-escapes');


//default indentation
test.INDENT = '  ';

//whether we run the only test
test.ONLY = false;

//default timeout for async tests
test.TIMEOUT = 2000;

//chain of nested test calls
var tests = [];
var testCount = 0;

//planned tests to run
var testQueue = [];


/**
 * Test enqueuer
 */
function test (message, fn) {
    //if run in exclusive mode - allow only `test.only` calls
    if (test.ONLY) return test;

    //ignore bad args
    if (!message) return test;

    //init test object params
    var testObj = {
        id: testCount++,
        title: message,
        status: null,
        fn: fn,
        children: [],
        async: false,
        last: false,
        _timeout: test.TIMEOUT
    };

    //mocha-compat only
    testObj.timeout = (function (value) {
        if (value == null) return this._timeout;
        this._timeout = value;
        return this;
    }).bind(testObj);

    //handle args
    if (!fn) {
        //if only message passed - do skip
        if (!fn && typeof message === 'string') {
            testObj.status = 'skip';
        }
        else {
            //detect test name
            testObj.fn = message;
            message = message.name;
            if (!message) message = 'Test #' + testObj.id;

            //update test title
            testObj.title = message;
        }
    }

    //detect async as at least one function argument
    testObj.async = !!(testObj.fn && testObj.fn.length);

    //nested tests are detected here
    //because calls to `.test` from children happen only when some test is active
    testObj.parent = tests[tests.length - 1];

    //register children
    if (testObj.parent) {
        testObj.parent.children.push(testObj);
    }
    //if test has no parent - plan it's separate run
    else {
        testQueue.push(testObj);
    }


    //run tests queue
    run();

    return test;
}

/**
 * Tests queue runner
 */
var currentTest;
function run () {
    //ignore active run
    if (currentTest) return;

    //get the planned test
    currentTest = testQueue.shift();

    //if the queue is empty - return
    if (!currentTest) return;

    //exec it, the promise will be formed
    exec(currentTest);

    //at the moment test is run, we know all it’s children
    //push all the children to the queue, after the current test
    //FIXME: this guy erases good stacktrace :< Maybe call asyncs last?
    var children = currentTest.children;

    for (var i = children.length; i--;){
        testQueue.unshift(children[i]);
    }

    //mark last kid
    if (children.length) {
        children[children.length - 1].last = true;
    }

    //if test is not async - run results at instant to avoid losing stacktrace
    if (!currentTest.async) {
        currentTest = null;
        run();
    }
    //plan running next test after the promise
    else {
        currentTest.promise.then(function () {
            currentTest = null;
            run();
        }, function () {
            currentTest = null;
            run();
        });
    }
}


/**
 * Test executor
 */
function exec (testObj) {
    //ignore skipping test
    if (testObj.status === 'skip') {
        testObj.promise = Promise.resolve();
        print(testObj);
        return testObj;
    }

    //save test to the chain
    tests.push(testObj);

    //display title of the test
    printTitle(testObj);


    //exec sync test
    if (!testObj.async) {
        testObj.promise = Promise.resolve();

        try {
            testObj.time = now();
            testObj.fn.call(testObj);
            testObj.time = now() - testObj.time;

            if (!testObj.status !== 'group') testObj.status = 'success';

            print(testObj);
        } catch (e) {
            error(e);
        }
    }
    //exec async test - it should be run in promise
    //sorry about the stacktrace, nothing I can do...
    else {
        //this race should be done within the timeout, self and all registered kids
        testObj.promise = Promise.race([
            new Promise(function (resolve, reject) {
                testObj.status = 'pending';
                testObj.time = now();
                testObj.fn.call(testObj, resolve);
            }),
            new Promise(function (resolve, reject) {
                setTimeout(function () {
                    reject(new Error('Timeout ' + testObj._timeout + 'ms reached. Please fix the test or set `this.timeout(' + (testObj._timeout + 1000) + ');`.'));
                }, testObj._timeout);
            })
        ]).then(function () {
            testObj.time = now() - testObj.time;
            if (testObj.status !== 'group') testObj.status = 'success';

            print(testObj);
        }, error);
    }

    //after promise’s executor, but after promise then’s
    //so user can’t create tests asynchronously, they should be created at once
    tests.pop();

    //error handler
    function error (e) {
        var parent = testObj.parent;
        while (parent) {
            parent.status = 'group';
            parent = parent.parent;
        }

        //update test status
        testObj.status = 'error';
        testObj.error = e;

        print(testObj);
    }

    return testObj;
}


//print title (indicator of started test)
var titleInterval;
function printTitle (testObj) {
    if (!isBrowser) {
        var frame = elegantSpinner();

        updateTitle();
        titleInterval = setInterval(updateTitle, 50);

        //update title frame
        function updateTitle () {
            //FIXME: this is the most undestructive for logs way of rendering, but crappy
            process.stdout.write(ansi.cursorLeft);
            process.stdout.write(ansi.eraseEndLine);
            process.stdout.write(chalk.white(indent(testObj) + ' ' + frame() + ' ' + testObj.title) + test.INDENT);
            // logUpdate(chalk.white(indent(test.indent) + ' ' + frame() + ' ' + test.title));
        }
    }
    //for browser - print grouped test name
    else {

    }
}
//clear printed title (mostly node)
function clearTitle () {
    if (!isBrowser && titleInterval) {
        clearInterval(titleInterval);
        process.stdout.write(ansi.cursorLeft);
        process.stdout.write(ansi.eraseEndLine);
    }
}


//universal printer dependent on resolved test
function print (testObj) {
    clearTitle();

    var single = testObj.children && testObj.children.length ? false : true;

    if (testObj.status === 'error') {
        printError(testObj);
    }
    else if (testObj.status === 'group') {
        printGroup(testObj, single);
    }
    else if (testObj.status === 'success') {
        printSuccess(testObj, single);
    }
    else if (testObj.status === 'skip') {
        printSkip(testObj, single);
    }

    //last child should close parent’s group in browser
    if (testObj.last) {
        if (isBrowser) {
            //if truly last - create as many groups as many last parents
            if (!testObj.children.length) {
                console.groupEnd();
                var parent = testObj.parent;
                while (parent && parent.last) {
                    console.groupEnd();
                    parent = parent.parent;
                }
            }
        } else {
            //create padding
            if (!testObj.children.length) console.log();
        }
    }
}


//print pure red error
function printError (testObj) {
    //browser shows errors better
    if (isBrowser) {
        console.group('%c× ' + testObj.title, 'color: red; font-weight: normal');
        if (testObj.error) {
            // if (testObj.error.name === 'AssertionError') {
            //     console.assert(false, testObj.error);
            // } else {
                // console.error(testObj.error);
            // }
            console.error(testObj.error.stack)
        }
        console.groupEnd();
    }
    else {
        console.log(chalk.red(indent(testObj) + ' × ') + chalk.red(testObj.title));

        //NOTE: node prints e.stack along with e.message
        if (testObj.error.stack) {
            var stack = testObj.error.stack.replace(/^\s*/gm, indent(testObj) + '   ');
            console.error(chalk.gray(stack));
        }
    }
}

//print green success
function printSuccess (testObj, single) {
    if (isBrowser) {
        if (single) {
            console.log('%c√ ' + testObj.title + '%c  ' + testObj.time.toFixed(2) + 'ms', 'color: green; font-weight: normal', 'color:rgb(150,150,150); font-size:0.9em');
        } else {
            printGroup(testObj);
        }
    }
    else {
        if (!single) {
            printGroup(testObj);
        }
        else {
            console.log(chalk.green(indent(testObj) + ' √ ') + chalk.green.dim(testObj.title) + chalk.gray(' ' + testObj.time.toFixed(2) + 'ms'));
        }
    }
}

//print yellow warning (not all tests passed)
function printGroup (testObj) {
    if (isBrowser) {
        console.group('%c+ ' + testObj.title + '%c  ' + testObj.time.toFixed(2) + 'ms', 'color: orange; font-weight: normal', 'color:rgb(150,150,150); font-size:0.9em');
    }
    else {
        console.log();
        console.log(indent(testObj) +' ' + chalk.yellow('+') + ' ' + chalk.yellow(testObj.title) + chalk.gray(' ' + testObj.time.toFixed(2) + 'ms'));
    }
}

//print blue skip
function printSkip (testObj, single) {
    if (isBrowser) {
        console[single ? 'log' : 'group']('%c- ' + testObj.title, 'color: blue');
    }
    else {
        console.log(chalk.cyan(indent(testObj) + ' - ') + chalk.cyan.dim(testObj.title));
    }
}


//return indentation of for a test, based on nestedness
function indent (testObj) {
    var parent = testObj.parent;
    var str = '';
    while (parent) {
        str += test.INDENT;
        parent = parent.parent;
    }
    return str;
}


//skip alias
test.skip = function skip (message) {
   return test(message);
};

//half-working only alias
test.only = function only (message, fn) {
    test.ONLY = false;
    test(message, fn);
    test.ONLY = true;
    return test;
}

//more obvious chain
test.test = test;



module.exports = test;