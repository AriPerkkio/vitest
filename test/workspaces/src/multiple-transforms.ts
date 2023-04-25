/* eslint-disable spaced-comment, unused-imports/no-unused-vars */

export default function run(a = 1, b = 2) {
  //! WORKSPACE_1_REMOVE_START

  // In workspace 1 we remove two functions
  function removedFunctionOne() {
    return 1
  }
  function removedFunctionThree() {
    return 1
  }

  //! WORKSPACE_1_REMOVE_END

  const unusedFunction1 = () => 1
  const unusedFunction2 = () => a ? b : null

  // Coverage of this branch breaks when combined coverage of workspaces is not handled correctly
  if (a === 1000 && b === 1) {
    // This should be uncovered
    return 1001
  }

  //! WORKSPACE_3_REMOVE_START

  // In workspace 3 we remove three branches
  if (a === 100 && b === 1)
    return 101

  if (a === 100 && b === 2)
    return 102

  if (a === 100 && b === 3)
    return 103

  //! WORKSPACE_3_REMOVE_END

  function unusedFunction3() {
    return 1
  }

  // Coverage of this branch breaks when combined coverage of workspaces is not handled correctly
  if (a === 1000 && b === 2) {
    // This should be uncovered
    return 1002
  }

  function unusedFunction4() {
    return 1
  }

  return 'OK'
}
