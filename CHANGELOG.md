# Changelog

## 0.4.0

* Add support for Bluz in module parser
* Add support for Core monolithic firmware in module parser

## 0.3.0

* add describe parser

## 0.2.4

* fixed a bunch of broken tests
* modified _walkChain to return module with needed version, not exact module found to be lacking
* added `findAnyMissingDependencies` to cover safe-modes as a result of non-user modules
* fixed `userModuleHasMissingDependencies` to use walkChain, fixes some misleading results
* refactors should also give large performance gains as a side-benefit
* notes on 


## 0.2.3

* fixed `userModuleHasMissingDependencies` to resolve if monolithic describe

## 0.2.2

* added `solveFirmwareModule` method in `HalDependencyResolver`
* added `toDescribe` and `areDependenciesMet` methods in `FirmwareModule`

## 0.2.1

* export `FirmwareModule`

## 0.2.0

* unified method/return names
* changed how module is exported

## 0.1.0

First public release

## 0.0.1


First release
